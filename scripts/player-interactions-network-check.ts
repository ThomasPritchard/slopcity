import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import WebSocket from 'ws';
import type { Room } from '@colyseus/sdk';
import type { TownState } from '../shared/state.ts';
import type { EmoteInbox } from '../shared/emotes.ts';
import type { WalletState } from '../shared/catalog.ts';
import { SEATS } from '../shared/social.ts';
import type { PrivateGuestProfile } from '../shared/profile.ts';
loadEnvFile('.env');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.DATABASE_URL!).hostname),'Use the local development database only');
// Node's built-in WebSocket does not support the SDK's custom header option.
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
const { Client } = await import('@colyseus/sdk');
const port = Number(process.env.TEST_PORT || 2574), endpoint = `http://127.0.0.1:${port}`;
const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';
const rooms: Room<unknown, TownState>[] = [];
const schema = `interactions_test_${randomUUID().replaceAll('-','')}`;
const admin = new Pool({connectionString:process.env.DATABASE_URL});
const isolated = new URL(process.env.DATABASE_URL!); isolated.searchParams.set('options',`-c search_path=${schema}`);
await admin.query(`CREATE SCHEMA ${schema}`);
const server = spawn(process.execPath, ['--import','tsx','server/index.ts'], { env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATABASE_URL:isolated.toString()}, stdio:['ignore','pipe','pipe'] });
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
const inboxes=new Map<string,EmoteInbox>();
const wallets=new Map<string,WalletState>();
const messages = new Map<string,string[]>();
function watch(room: Room<unknown,TownState>) {
 rooms.push(room); messages.set(room.sessionId,[]);
 room.onMessage<{body:string}>('chat',message => messages.get(room.sessionId)!.push(message.body));
 room.onMessage('voice-neighbours',()=>{}); room.onMessage('notice',()=>{});
 room.onMessage<WalletState>('economy',message=>wallets.set(room.sessionId,message));
 room.onMessage<EmoteInbox>('emote-inbox',message=>inboxes.set(room.sessionId,message));room.onMessage('social-changed',()=>{}); room.onMessage('economy-error',()=>{});
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
async function api(cookie:string,path:string,method='GET',body?:unknown){return fetch(endpoint+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
try {
 await until(async()=>{try{return (await fetch(endpoint+'/health')).ok;}catch{return false;}},'health');
 const ga=await guest('Pair A'),gb=await guest('Pair B');
 const a=watch(await client(ga.cookie).create<TownState>('town')),b=watch(await client(gb.cookie).joinById<TownState>(a.roomId));
 await until(()=>a.state?.players?.size===2&&b.state?.players?.size===2,'two clients');
 const pa=()=>a.state.players.get(a.sessionId)!,pb=()=>a.state.players.get(b.sessionId)!;
 a.send('emote-command',{action:'request',targetId:gb.profile.id,kind:'handshake'});
 await until(()=>!!inboxes.get(b.sessionId)?.incoming,'private invitation');const invite=inboxes.get(b.sessionId)!.incoming!;
 a.send('emote-command',{action:'accept',id:invite.id});await delay(120);assert.equal(pa().emoteId,'');
 b.send('emote-command',{action:'accept',id:invite.id});await until(()=>pa().emoteId===invite.id&&b.state.players.get(a.sessionId)?.emoteId===invite.id,'consented pair');
 assert.equal(pa().emoteAt,pb().emoteAt);assert.notEqual(pa().emoteRole,pb().emoteRole);assert.equal(pa().emoteKind,'handshake');
 const gc=await guest('Late observer');const c=watch(await client(gc.cookie).joinById<TownState>(a.roomId));
 await until(()=>c.state?.players?.get(a.sessionId)?.emoteId===invite.id,'late observer pair');
 assert.equal(c.state.players.get(a.sessionId)!.emoteAt,pa().emoteAt);c.send('emote-command',{action:'sync'});await delay(100);assert.equal(inboxes.get(c.sessionId)?.incoming,null);assert.equal(inboxes.get(c.sessionId)?.outgoing,null);
 b.send('emote-command',{action:'accept',id:invite.id});await delay(100);assert.equal(pa().emoteId,invite.id);
 a.send('input',{x:0,z:-1,seq:nextSeq(a)});await until(()=>!pa().emoteId&&!pb().emoteId,'movement cancels pair');a.send('input',{x:0,z:0,seq:nextSeq(a)});
 await walk(c,5,-17);await walk(a,-3.15,-17);await walk(b,-2.25,-17);
 console.log('PASS: private recipient consent, repeated acceptance, paired timeline replicated to both and late observer, movement cancellation.');
 // Same-duration stale-input pulses provide a network bound; exact multiplier is unit checked.
 const z=pa().z;a.send('input',{x:0,z:-99999,sprint:true,seq:nextSeq(a)});await delay(550);const moved=z-pa().z;
 assert.ok(moved>1&&moved<1.7,`bounded sprint distance ${moved}`);const stopped=pa().z;
 a.send('input',{x:0,z:1,sprint:true,seq:1});await delay(300);assert.equal(pa().z,stopped);
 a.send('jump');await until(()=>pa().jumpAt>0&&b.state.players.get(a.sessionId)!.jumpAt===pa().jumpAt,'replicated hop');const jumped=pa().jumpAt;
 a.send('jump');await delay(120);assert.equal(pa().jumpAt,jumped);await delay(800);a.send('jump');await until(()=>pa().jumpAt>jumped,'hop cooldown release');await delay(700);
 await walk(a,-3.15,-17);
 console.log('PASS: bounded sprint, stale input ignored, hop start replicated and cooldown enforced.');
 const request=async()=>{a.send('emote-command',{action:'request',targetId:gb.profile.id,kind:'hug'});await until(()=>!!inboxes.get(b.sessionId)?.incoming,'hug invitation');return inboxes.get(b.sessionId)!.incoming!.id;};
 await delay(2600);let id=await request();c.send('emote-command',{action:'accept',id});await delay(100);assert.equal(pa().emoteId,'');assert.equal(inboxes.get(c.sessionId)?.incoming,null);assert.equal(inboxes.get(b.sessionId)?.incoming?.id,id);b.send('interaction-busy',true);await until(()=>!inboxes.get(a.sessionId)?.outgoing,'busy cancels invite');b.send('interaction-busy',false);b.send('emote-command',{action:'accept',id});await delay(120);assert.equal(pa().emoteId,'');
 await delay(2600);id=await request();await api(gb.cookie,`/api/blocks/${ga.profile.id}`,'PUT');await until(()=>!inboxes.get(a.sessionId)?.outgoing,'block cancels invite');await api(gb.cookie,`/api/blocks/${ga.profile.id}`,'DELETE');
 await delay(2600);id=await request();await until(()=>!inboxes.get(a.sessionId)?.outgoing,'invitation expiry',14000);b.send('emote-command',{action:'accept',id});await delay(100);assert.equal(pa().emoteId,'');
 console.log('PASS: live busy, block, expiry and stale acceptance cleanup.');
 let response=await api(ga.cookie,'/api/social/friends','POST',{targetId:gb.profile.id,action:'request'});assert.equal(response.status,200);
 response=await api(gb.cookie,'/api/social');assert.equal((await response.json()).incoming[0].profileId,ga.profile.id);
 response=await api(gb.cookie,'/api/social/friends','POST',{targetId:ga.profile.id,action:'accept'});assert.equal(response.status,200);assert.equal((await response.json()).friends[0].profileId,ga.profile.id);
 const fixture=new Pool({connectionString:isolated.toString()});
 try{
  // Isolated fixture salary ledger entry uses the production allowance trigger, not wall-clock salary proof.
  await fixture.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,'salary:network-fixture','salary',100)",[ga.profile.id]);
 }finally{await fixture.end();}
 const requestId=randomUUID(),gift={targetId:gb.profile.id,amount:25,requestId};
 response=await api(ga.cookie,'/api/social/gifts','POST',gift);assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.giftingAllowance,75);assert.equal(receipt.replayed,false);
 await until(()=>wallets.get(a.sessionId)?.balance===receipt.wallet.balance&&wallets.get(b.sessionId)?.balance===1025,'private wallets updated');
 assert.equal('balance' in pa(),false);assert.equal('giftingAllowance' in pa(),false);
 response=await api(ga.cookie,'/api/social/gifts','POST',{...gift,amount:26});assert.equal(response.status,409);
 const disconnectInvite=await request();b.send('emote-command',{action:'accept',id:disconnectInvite});await until(()=>pa().emoteId===disconnectInvite,'pair before disconnect');
 await b.leave();rooms.splice(rooms.indexOf(b),1);await until(()=>!a.state.players.has(b.sessionId),'target disconnected');await until(()=>!pa().emoteId,'disconnect clears partner');
 response=await api(ga.cookie,'/api/social/gifts','POST',gift);assert.equal(response.status,200);assert.equal((await response.json()).replayed,true);
 console.log('PASS: real HTTP mutual friends, fixture salary allowance, atomic gift receipt, private wallet updates, payload conflict and offline replay.');
 const seat=SEATS.find(s=>s.benchId==='south-west')!;await walk(a,-7,-17);await walk(a,-7,-7);await walk(a,seat.x,seat.z);
 a.send('sit',seat.id);await until(()=>pa().seatId===seat.id,'bench seated');const priorHop=pa().jumpAt;a.send('jump');await delay(150);assert.equal(pa().jumpAt,priorHop);a.send('stand');await until(()=>!pa().seatId,'stand');
 console.log('PASS: seated hop denied.');
 await walk(a,-7,-7);await walk(a,-7,-25);a.send('jump');for(let i=0;i<10;i++){a.send('input',{x:0,z:-99999,sprint:true,seq:nextSeq(a)});await delay(50);}await delay(350);assert.ok(pa().z>=-26);assert.ok(pa().z<-25.5);console.log('PASS: sprinting hop cannot cross the southern world wall.');
}finally{
 await Promise.allSettled(rooms.map(room=>room.leave()));server.kill('SIGTERM');await until(()=>server.exitCode!==null||server.signalCode!==null,'server exit');await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
}
