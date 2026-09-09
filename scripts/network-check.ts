import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import WebSocket from 'ws';
import type { Room } from '@colyseus/sdk';
import type { TownState } from '../shared/state.ts';
import { SEATS } from '../shared/social.ts';
import type { PrivateGuestProfile } from '../shared/profile.ts';
loadEnvFile('.env');
// Node's built-in WebSocket does not support the SDK's custom header option.
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
const { Client } = await import('@colyseus/sdk');
const port = Number(process.env.TEST_PORT || 2568), endpoint = `http://127.0.0.1:${port}`;
const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';
const rooms: Room<unknown, TownState>[] = [];
const schema = `network_test_${randomUUID().replaceAll('-','')}`;
const admin = new Pool({connectionString:process.env.DATABASE_URL});
const isolated = new URL(process.env.DATABASE_URL!); isolated.searchParams.set('options',`-c search_path=${schema}`);
await admin.query(`CREATE SCHEMA ${schema}`);
const server = spawn(process.execPath, ['--import','tsx','server/index.ts'], { env:{...process.env,PORT:String(port),DATABASE_URL:isolated.toString()}, stdio:['ignore','pipe','pipe'] });
// Do not output child logs: they could contain credentials from third-party errors.
server.stdout.resume(); server.stderr.resume();
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 8000) {
 const start = performance.now(); while (!(await check())) { if (performance.now()-start>timeout) throw new Error(`Timed out: ${label}`); await delay(30); }
}
async function guest(name: string) {
 const response = await fetch(`${endpoint}/api/guest`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name,shirt:1,skin:2})});
 assert.equal(response.status,201);
 return {cookie:response.headers.get('set-cookie')!.split(';')[0],profile:await response.json() as PrivateGuestProfile};
}
const messages = new Map<string,string[]>();
function watch(room: Room<unknown,TownState>) {
 rooms.push(room); messages.set(room.sessionId,[]);
 room.onMessage<{body:string}>('chat',message => messages.get(room.sessionId)!.push(message.body));
 room.onMessage('voice-neighbours',()=>{}); room.onMessage('notice',()=>{});
 room.onMessage('economy',()=>{}); room.onMessage('economy-error',()=>{});
 room.onMessage('casino-state',()=>{}); room.onMessage('casino-private',()=>{}); room.onMessage('casino-receipt',()=>{});
 return room;
}
const client = (cookie: string, requestOrigin = origin) => new Client(endpoint,{headers:{Cookie:cookie,Origin:requestOrigin}});
const sequences = new Map<string,number>();
async function walk(room: Room<unknown,TownState>, x: number,z: number) {
 await until(async () => {
  const p=room.state.players.get(room.sessionId)!; const dx=x-p.x,dz=z-p.z;
  if (Math.hypot(dx,dz)<.18) { room.send('input',{x:0,z:0,seq:nextSeq(room)}); return true; }
  room.send('input',{x:dx,z:dz,seq:nextSeq(room)}); await delay(50); return false;
 },'walk to seating',15000);
}
function nextSeq(room: Room<unknown,TownState>) { const seq=(sequences.get(room.sessionId)??100)+1; sequences.set(room.sessionId,seq); return seq; }
try {
 await until(async()=> {try{return (await fetch(`${endpoint}/health`)).ok;}catch{return false;}},'server health');
 const firstGuest=await guest('Observer');
 await assert.rejects(()=>client(firstGuest.cookie,'http://evil.invalid').create('town'));
 await assert.rejects(()=>client('').create('town'));
 const first=watch(await client(firstGuest.cookie).create<TownState>('town',{name:'FORGED',shirt:5,skin:4}));
 await until(()=>!!first.state?.players?.get(first.sessionId),'first state');
 assert.equal(first.state.players.get(first.sessionId)!.name,'Observer');
 assert.equal(first.state.players.get(first.sessionId)!.shirt,1);
 assert.equal(first.state.players.get(first.sessionId)!.skin,2);
 await assert.rejects(()=>client(firstGuest.cookie).joinById(first.roomId));
 assert.ok(first.state.players.has(first.sessionId));
 console.log('PASS: cookie/origin authentication, saved cosmetics and duplicate guest protection.');
 const secondGuest=await guest('Second');
 const second=watch(await client(secondGuest.cookie).joinById<TownState>(first.roomId));
 for(let i=2;i<64;i++){const g=await guest(`Citizen ${i}`);watch(await client(g.cookie).joinById<TownState>(first.roomId));}
 await until(()=>rooms.every(room=>room.state?.players?.size===64),'64 shared citizens');
 const overflow=await guest('Overflow');await assert.rejects(()=>client(overflow.cookie).joinById(first.roomId));
 console.log('PASS: 64 independent clients share population; 65th admission rejected.');
 const start=first.state.players.get(second.sessionId)!, x=start.x,z=start.z;
 for(let seq=0;seq<100;seq++)second.send('input',{x:0,z:99999,seq});
 await until(()=>first.state.players.get(second.sessionId)!.ack===99,'movement ack');await delay(400);
 const end=first.state.players.get(second.sessionId)!;
 assert.ok(end.z>z);assert.ok(Math.hypot(end.x-x,end.z-z)<=1.1);
 const stopped=end.z;await delay(300);assert.equal(first.state.players.get(second.sessionId)!.z,stopped);
 second.send('input',{x:0,z:-1,seq:1});await delay(150);assert.equal(first.state.players.get(second.sessionId)!.z,stopped);
 second.send('wave');await until(()=>first.state.players.get(second.sessionId)!.wave>0,'wave');
 second.send('chat','visible');await until(()=>messages.get(first.sessionId)!.includes('visible'),'chat');
 const block=await fetch(`${endpoint}/api/blocks/${secondGuest.profile.id}`,{method:'PUT',headers:{Origin:origin,Cookie:firstGuest.cookie}});assert.equal(block.status,200);
 await assert.rejects(()=>client(firstGuest.cookie).joinById(first.roomId));
 await delay(900);second.send('chat','blocked second');first.send('chat','blocked first');await delay(350);
 assert.ok(!messages.get(first.sessionId)!.includes('blocked second'));assert.ok(!messages.get(second.sessionId)!.includes('blocked first'));
 assert.ok(messages.get(rooms[2].sessionId)!.includes('blocked second'));
 await fetch(`${endpoint}/api/blocks/${secondGuest.profile.id}`,{method:'DELETE',headers:{Origin:origin,Cookie:firstGuest.cookie}});
 await delay(900);second.send('chat','unblocked');await until(()=>messages.get(first.sessionId)!.includes('unblocked'),'unblocked chat');
 console.log('PASS: bounded movement, stale/replayed input rejection, wave, chat and symmetric block/unblock.');
 const seat=SEATS.find(s=>s.benchId==='south-west')!;
 for(const room of [first,second]) {await walk(room,-7,room.state.players.get(room.sessionId)!.z);await walk(room,-7,-7);await walk(room,seat.x,seat.z);}
 first.send('sit',seat.id);second.send('sit',seat.id);
 await until(()=>[...first.state.players.values()].some(p=>p.seatId===seat.id),'seat race');await delay(150);
 assert.equal([...first.state.players.values()].filter(p=>p.seatId===seat.id).length,1);
 const winner=first.state.players.get(first.sessionId)!.seatId?first:second,loser=winner===first?second:first;
 winner.send('stand');await until(()=>!first.state.players.get(winner.sessionId)!.seatId,'stand');
 loser.send('sit',seat.id);await until(()=>first.state.players.get(loser.sessionId)!.seatId===seat.id,'seat reuse');
 await loser.leave();rooms.splice(rooms.indexOf(loser),1);
 await until(()=>!winner.state.players.has(loser.sessionId),'disconnect removes seated player');
 winner.send('sit',seat.id);await until(()=>winner.state.players.get(winner.sessionId)!.seatId===seat.id,'disconnect releases seat');
 console.log('PASS: shared seat race has one winner; stand and disconnect release occupancy.');
} finally {
 await Promise.allSettled(rooms.map(room=>room.leave()));server.kill('SIGTERM');
 await until(()=>server.exitCode!==null || server.signalCode!==null,'test server exit');
 await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
}
