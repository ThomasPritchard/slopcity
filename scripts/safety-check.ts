// Local integration only: disposable schema/server; never touches saved town data.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { Client, type Room } from '@colyseus/sdk';
import { chromium } from 'playwright';
import { hashCommunityPassword } from '../server/communityAuth.ts';

if (!process.env.DATABASE_URL) throw new Error('Load the local .env for the isolated safety check.');
const dbURL=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1','[::1]'].includes(dbURL.hostname))throw new Error('Safety check requires a loopback development database.');
const schema=`safety_test_${randomUUID().replaceAll('-','')}`,pool=new Pool({connectionString:dbURL.toString()});
const isolated=new URL(dbURL);isolated.searchParams.set('options',`-c search_path=${schema}`);
const bind=createServer();bind.listen(0,'127.0.0.1');await once(bind,'listening');const address=bind.address();assert.ok(address&&typeof address==='object');const port=address.port;await new Promise<void>(resolve=>bind.close(()=>resolve()));
const endpoint=`http://127.0.0.1:${port}`,origin='http://localhost:5173',key=randomBytes(32).toString('hex'),password=randomBytes(24).toString('base64url');
const passwordHash=await hashCommunityPassword(password),rooms:Room[]=[];let child:ChildProcess|undefined;let logs='';
const out='output/playwright/safety';await mkdir(out,{recursive:true});
const headers=(ip='203.0.113.200',cookie?:string)=>({'x-slop-proxy-key':key,'x-slop-client-ip':ip,origin,'content-type':'application/json',...(cookie?{cookie}:{})});
async function request(path:string,method='GET',body?:unknown,ip?:string,cookie?:string){return fetch(endpoint+path,{method,signal:AbortSignal.timeout(10_000),headers:headers(ip,cookie),...(body===undefined?{}:{body:JSON.stringify(body)})});}
async function until(fn:()=>boolean|Promise<boolean>,label:string){for(let i=0;i<100;i++){if(await fn())return;await delay(100);}throw new Error(`Timed out: ${label}`);}
async function start(){
 child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,DATABASE_URL:isolated.toString(),HOST:'127.0.0.1',PORT:String(port),APP_ORIGIN:origin,NODE_ENV:'test',ABUSE_PROXY_SECRET:key,COMMUNITY_ADMIN_PASSWORD_HASH:passwordHash},stdio:['ignore','pipe','pipe']});
 child.stdout!.on('data',v=>{logs+=v.toString();});child.stderr!.on('data',v=>{logs+=v.toString();});
 await until(async()=>{if(child?.exitCode!==null)throw new Error('Isolated server exited before health check.');try{return (await fetch(endpoint+'/health')).ok;}catch{return false;}},'isolated server startup');
}
async function stop(){if(child?.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');const kill=setTimeout(()=>child?.kill('SIGKILL'),30_000);await exit;clearTimeout(kill);}}
async function guest(name:string,ip:string){const response=await request('/api/guest','POST',{name,shirt:0,skin:0},ip);assert.equal(response.status,201);return {profile:await response.json() as {id:string;name:string},cookie:response.headers.get('set-cookie')!.split(';')[0],ip};}
function sdk(g:{ip:string;cookie:string}){return new Client(endpoint,{headers:headers(g.ip,g.cookie)});}
async function join(g:{ip:string;cookie:string},roomId?:string){const room=roomId?await sdk(g).joinById(roomId):await sdk(g).create('town');room.onMessage('*',()=>{});rooms.push(room);return room;}
async function login(){const response=await request('/api/community/admin/login','POST',{password});assert.equal(response.status,204);return response.headers.get('set-cookie')!.split(';')[0];}
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try {
 await pool.query(`CREATE SCHEMA ${schema}`);await start();
 const admin=await login();
 assert.equal((await request('/api/community/admin/safety')).status,401);
 assert.equal((await fetch(endpoint+'/api/guest',{method:'POST',headers:{origin,'content-type':'application/json','x-slop-client-ip':'192.0.2.1'},body:JSON.stringify({name:'Spoof',shirt:0,skin:0})})).status,503);
 assert.equal((await fetch(endpoint+'/api/community/admin/safety',{headers:{cookie:admin,'x-slop-client-ip':'192.0.2.1','x-slop-proxy-key':'é'.repeat(64)}})).status,503);
 for(let i=0;i<30;i++)await request('/matchmake/reconnect/not-a-room','POST',{reconnectionToken:'invalid'},'198.51.100.250');
 assert.equal((await request('/matchmake/reconnect/not-a-room','POST',{reconnectionToken:'invalid'},'198.51.100.250')).status,429,'invalid reconnects also consume admission quota');
 const alice=await guest('Safety Alice','198.51.100.1'),bob=await guest('Safety Bob','198.51.100.1');
 let a=await join(alice);let b=await join(bob,a.roomId);let aLeft=false,bLeft=false;a.onLeave(()=>{aLeft=true;});b.onLeave(()=>{bLeft=true;});
 assert.equal((await request('/api/community/admin/safety','GET',undefined,undefined,admin)).status,200);
 const banned=await request('/api/community/admin/safety/bans','POST',{kind:'guest',target:alice.profile.id,reason:'Integration guest ban',durationMinutes:null},undefined,admin);assert.equal(banned.status,201);const ban=await banned.json();
 await until(()=>aLeft,'guest immediately removed');assert.equal(bLeft,false);
 assert.equal((await request('/api/profile','GET',undefined,alice.ip,alice.cookie)).status,403);await assert.rejects(()=>join(alice));
 await request(`/api/community/admin/safety/bans/${ban.id}`,'DELETE',undefined,undefined,admin);
 a=await join(alice,b.roomId);aLeft=false;a.onLeave(()=>{aLeft=true;});
 const ipBan=await request('/api/community/admin/safety/bans','POST',{kind:'ip',target:'::ffff:198.51.100.1',reason:'Integration network ban',durationMinutes:60},undefined,admin);assert.equal(ipBan.status,201);const ipBanValue=await ipBan.json();
 await until(()=>aLeft&&bLeft,'both guests removed by IP ban');
 assert.equal((await request('/matchmake/reconnect/not-a-room','POST',{reconnectionToken:'invalid'},alice.ip)).status,403);
 assert.equal((await request('/api/guest','POST',{name:'New banned guest',shirt:0,skin:0},alice.ip)).status,403);
 assert.equal((await request('/api/community/admin/safety','GET',undefined,alice.ip,admin)).status,200,'admin remains reachable from a banned network');
 await stop();await start();const adminAfterRestart=await login();
 assert.equal((await request('/api/profile','GET',undefined,alice.ip,alice.cookie)).status,403,'ban persists through full server restart');
 await request(`/api/community/admin/safety/bans/${ipBanValue.id}`,'DELETE',undefined,undefined,adminAfterRestart);
 a=await join(alice);let flooded=false;a.onLeave(()=>{flooded=true;});for(let i=0;i<150;i++)a.send('input',{x:0,z:0,seq:i});
 await until(()=>flooded,'message flood disconnected');
 const snap=await(await request('/api/community/admin/safety','GET',undefined,undefined,adminAfterRestart)).json();assert.ok(snap.metrics.some((m:any)=>m.name==='message_flood_disconnected'&&m.count>0));
 for(let i=0;i<10;i++)await guest(`Quota ${i}`,'198.51.100.50');
 const rejected=await request('/api/guest','POST',{name:'Quota exceeded',shirt:0,skin:0},'198.51.100.50');assert.equal(rejected.status,429);assert.ok(rejected.headers.get('retry-after'));
 assert.equal((await request('/api/guest','POST',{name:'Same saved guest',shirt:0,skin:0},'198.51.100.50',bob.cookie)).status,200,'restores do not consume guest creation quota');
 // Real browser UI, real isolated backend; route only API traffic to the disposable server.
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/game/**',async route=>{const req=route.request(),url=new URL(req.url());const response=await route.fetch({url:endpoint+url.pathname.replace(/^\/game/,'')+url.search,headers:{...req.headers(),...headers('203.0.113.200',req.headers().cookie)}});await route.fulfill({response});});
 await page.goto(origin+'/admin');await page.getByLabel('Admin password').fill(password);await page.getByRole('button',{name:'Open the review desk',exact:true}).click();
 await page.getByRole('heading',{name:'Town safety',exact:true}).waitFor();
 await page.getByLabel('Name or guest ID',{exact:true}).fill('Safety Bob');await page.getByRole('button',{name:'Search guests',exact:true}).click();await page.getByRole('button',{name:'Ban saved guest Safety Bob',exact:true}).click();
 await page.getByLabel('Reason',{exact:true}).fill('Browser integration ban');await page.getByRole('button',{name:'Review ban',exact:true}).click();await page.getByRole('button',{name:'Confirm ban',exact:true}).click();
 await page.getByRole('button',{name:`Lift ban for ${bob.profile.id}`,exact:true}).waitFor();
 assert.equal((await request('/api/profile','GET',undefined,bob.ip,bob.cookie)).status,403);
 for(const[label,width,height]of[['desktop',1440,1000],['portrait',390,844],['landscape',844,390]]as const){await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${out}/admin-${label}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await page.getByRole('button',{name:`Lift ban for ${bob.profile.id}`,exact:true}).click();await page.getByRole('button',{name:'Confirm lift',exact:true}).click();await page.getByRole('button',{name:`Lift ban for ${bob.profile.id}`,exact:true}).waitFor({state:'detached'});
 assert.equal((await request('/api/profile','GET',undefined,bob.ip,bob.cookie)).status,200);
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByLabel('Admin password').waitFor();assert.deepEqual(errors,[]);
 const audit=await pool.query(`SELECT count(*)::int AS count FROM ${schema}.safety_audit`);assert.ok(audit.rows[0].count>=6);
 await writeFile(`${out}/results.json`,JSON.stringify({passed:true,checks:['guest creation quota and cookie restore','forged proxy identity rejected','real guest/IP bans remove matching WebSockets','guest ban prevents restore and rejoin','admin rescue from banned IP','ban survives process restart','message flood disconnect and metrics','authenticated browser search, ban and unban','desktop, portrait, landscape without horizontal overflow','browser logout','durable admin audit'],errors},null,2));
 console.log('PASS: isolated safety HTTP, WebSocket, PostgreSQL restart and responsive admin browser checks.');
} catch(error) {
 console.error(error instanceof Error?error.message:'Safety check failed.');
 // Redact fixture credentials even if a dependency unexpectedly includes them in diagnostics.
 await writeFile(`${out}/server.log`,logs.replaceAll(key,'[redacted]').replaceAll(password,'[redacted]').replaceAll(passwordHash,'[redacted]').replaceAll(isolated.toString(),'[redacted]'));
 throw error;
} finally {
 await browser?.close();for(const room of rooms)try{await Promise.race([room.leave(),delay(100)]);}catch{}await stop();await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();
}
