// Disposable database + real HTTP/WebSocket/browser flow, with a simulated challenge provider.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import WebSocket from 'ws';
import { Client, type Room } from '@colyseus/sdk';
import { chromium } from 'playwright';
import { createServer as viteServer, type ViteDevServer } from 'vite';
import { hashCommunityPassword } from '../server/communityAuth.ts';

const dbURL = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost','127.0.0.1'].includes(dbURL.hostname)) throw new Error('Admission tests require a loopback development database');
const schema=`admission_test_${randomUUID().replaceAll('-','')}`,pool=new Pool({connectionString:dbURL.toString()});
const isolated=new URL(dbURL);isolated.searchParams.set('options',`-c search_path=${schema}`);
async function freePort() { const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));return port; }
const port=await freePort(),webPort=await freePort(),endpoint=`http://127.0.0.1:${port}`,origin=`http://localhost:${webPort}`;
const key=randomBytes(32).toString('hex'),password=randomBytes(24).toString('base64url'),passwordHash=await hashCommunityPassword(password);
const out='output/playwright/admission';await mkdir(out,{recursive:true});
const headers=(cookie?:string,ip='198.51.100.1')=>({origin,'x-slop-proxy-key':key,'x-slop-client-ip':ip,'content-type':'application/json',...(cookie?{cookie}:{})});
const request=(path:string,method='GET',body?:unknown,cookie?:string,ip?:string)=>fetch(endpoint+path,{method,headers:headers(cookie,ip),signal:AbortSignal.timeout(15_000),...(body===undefined?{}:{body:JSON.stringify(body)})});
const token=()=>`fixture-${randomUUID()}`;
let child:ChildProcess|undefined,web:ViteDevServer|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,logs='';const rooms:Room[]=[];
async function until(fn:()=>boolean|Promise<boolean>,label:string) { for(let i=0;i<150;i++){if(await fn())return;await delay(100);}throw new Error(`Timed out: ${label}`); }
async function start() {
 child=spawn(process.execPath,['--import','tsx','scripts/fixtures/admission-server.ts'],{env:{...process.env,DATABASE_URL:isolated.toString(),NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(port),APP_ORIGIN:origin,APP_ORIGINS:'',ABUSE_PROXY_SECRET:key,COMMUNITY_ADMIN_PASSWORD_HASH:passwordHash,TURNSTILE_SITE_KEY:'admission-test-site',TURNSTILE_SECRET_KEY:'admission-test-secret',TWITCH_CLIENT_ID:'',TWITCH_CLIENT_SECRET:''},stdio:['ignore','pipe','pipe']});
 child.stdout!.on('data',v=>logs+=v);child.stderr!.on('data',v=>logs+=v);
 await until(async()=>{if(child?.exitCode!==null)throw new Error('Isolated admission server exited');try{return(await fetch(endpoint+'/health')).ok;}catch{return false;}},'server startup');
}
async function stop() {if(child?.exitCode===null){const ended=once(child,'exit');child.kill('SIGTERM');const timeout=setTimeout(()=>child?.kill('SIGKILL'),30_000);await ended;clearTimeout(timeout);}}
async function guest(name:string) { const result=await request('/api/guest','POST',{name,shirt:0,skin:0,turnstileToken:token()});assert.equal(result.status,201);return {profile:await result.json() as {id:string},cookie:result.headers.get('set-cookie')!.split(';')[0]}; }
async function verify(cookie:string) { const result=await request('/api/admission','POST',{turnstileToken:token()},cookie);assert.equal(result.status,204); }
async function join(cookie:string) {const room=await new Client(endpoint,{headers:headers(cookie)}).joinOrCreate('town');room.onMessage('*',()=>{});rooms.push(room);return room;}
async function login() {const result=await request('/api/community/admin/login','POST',{password});assert.equal(result.status,204);return result.headers.get('set-cookie')!.split(';')[0];}
try {
 await pool.query(`CREATE SCHEMA ${schema}`);await start();
 assert.equal((await request('/api/admission')).status,200);
 for(const body of [{name:'No check',shirt:0,skin:0},{name:'Fake check',shirt:0,skin:0,turnstileToken:'fake'}])assert.equal((await request('/api/guest','POST',body)).status,403);
 assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${schema}.guest_profiles`)).rows[0].count,0);
 const alice=await guest('Admission Alice'),bob=await guest('Admission Bob');
 const a=await join(alice.cookie);let left=false,check=false;a.onLeave(()=>left=true);a.onMessage('entry-check',()=>check=true);
 assert.equal((await request('/api/admission','GET',undefined,alice.cookie)).status,200);
 await assert.rejects(()=>join(alice.cookie),'consumed pass cannot reserve another connection');
 const directStatus = await new Promise<number>((resolve,reject)=>{
  const socket=new WebSocket(endpoint.replace('http:','ws:')+'/invalid/town?sessionId=forged',{headers:headers(alice.cookie,'198.51.100.99'),handshakeTimeout:5000});
  socket.on('unexpected-response',(_req,response)=>{response.resume();resolve(response.statusCode!);socket.terminate();});
  socket.on('open',()=>{socket.close();reject(new Error('Unverified raw socket was admitted'));});socket.on('error',reject);
 });
 assert.equal(directStatus,403,'direct WebSocket bypass with a changed IP is refused');
 const reused=token();assert.equal((await request('/api/admission','POST',{turnstileToken:reused},bob.cookie)).status,204);assert.equal((await request('/api/admission','POST',{turnstileToken:reused},bob.cookie)).status,403);
 const admin=await login();
 assert.equal((await request('/api/community/admin/admission','POST',{action:'mode',target:'paused'})).status,401);
 assert.equal((await request('/api/community/admin/admission','POST',{action:'mode',target:'paused'},admin)).status,200);
 await assert.rejects(()=>join(bob.cookie));assert.equal(left,false,'pause keeps connected viewers');
 assert.equal((await request('/api/guest','POST',{name:'Paused',shirt:0,skin:0,turnstileToken:token()})).status,403);
 assert.equal((await request('/api/community/admin/admission','POST',{action:'reverify',target:'all'},admin)).status,200);await until(()=>check,'connected client receives recheck');
 await verify(alice.cookie);assert.equal((await(await request('/api/community/admin/admission','GET',undefined,admin)).json()).pending,0);
 assert.equal((await request('/api/community/admin/admission','POST',{action:'mode',target:'approved'},admin)).status,200);
 await verify(bob.cookie);await assert.rejects(()=>join(bob.cookie));
 assert.equal((await request('/api/community/admin/admission','POST',{action:'approve',target:bob.profile.id},admin)).status,200);
 await verify(bob.cookie);const b=await join(bob.cookie);await b.leave();await a.leave();
 await stop();await start();await assert.rejects(()=>join(bob.cookie),'restart invalidates all old passes');
 const restoredAdmin=await login();const restored=await(await request('/api/community/admin/admission','GET',undefined,restoredAdmin)).json();assert.equal(restored.mode,'approved');assert.ok(restored.approved.some((g:any)=>g.id===bob.profile.id));
 await verify(bob.cookie);const rejoined=await join(bob.cookie);await rejoined.leave();
 await request('/api/community/admin/admission','POST',{action:'mode',target:'open'},restoredAdmin);
 // Browser widget is a named fixture; no claim of Cloudflare bot detection is made.
 web=await viteServer({configFile:false,server:{host:'127.0.0.1',port:webPort,strictPort:true,proxy:{'/game':{target:endpoint,ws:true,headers:{'x-slop-proxy-key':key,'x-slop-client-ip':'198.51.100.20'},rewrite:path=>path.replace(/^\/game/,'')}}}});await web.listen();
 browser=await chromium.launch({headless:true,args:['--use-angle=metal']});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*',route=>route.fulfill({contentType:'application/javascript',body:`window.turnstile={render(el,options){el.textContent='Verification test fixture';setTimeout(()=>options.callback('fixture-'+crypto.randomUUID()),10);return 'fixture';},remove(){},reset(){}};`}));
 await page.goto(origin);await page.getByRole('textbox',{name:'What should we call you?'}).fill('Browser neighbour');await page.getByRole('button',{name:'Choose your look',exact:true}).click();
 await page.getByRole('dialog',{name:'A quick check before you join.'}).waitFor();
 for(const[label,width,height]of[['desktop',1440,1000],['portrait',390,844],['landscape',844,390]]as const){await page.setViewportSize({width,height});await page.screenshot({path:`${out}/entry-${label}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Join the square',exact:true}).waitFor({timeout:60_000});
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Join the square',exact:true}).click();await page.getByRole('button',{name:'Open neighbours',exact:true}).waitFor({timeout:60_000});
 await request('/api/community/admin/admission','POST',{action:'reverify',target:'all'},restoredAdmin);await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Continue',exact:true}).click();await until(async()=>(await(await request('/api/community/admin/admission','GET',undefined,restoredAdmin)).json()).pending===0,'browser recheck accepted');
 await page.goto(origin+'/admin');await page.getByLabel('Admin password').fill(password);await page.getByRole('button',{name:'Open the review desk',exact:true}).click();await page.getByRole('heading',{name:'Entry & raid controls'}).waitFor();
 await page.getByLabel('Town entry',{exact:true}).selectOption('paused');await page.getByRole('button',{name:'Save entry mode',exact:true}).click();await page.getByText('Entry mode saved. Players already in town can stay.',{exact:true}).waitFor();
 for(const[label,width,height]of[['desktop',1440,1000],['portrait',390,844],['landscape',844,390]]as const){await page.setViewportSize({width,height});await page.getByRole('heading',{name:'Entry & raid controls'}).scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/controls-${label}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 assert.deepEqual(errors,[]);
 await writeFile(`${out}/results.json`,JSON.stringify({passed:true,provider:'simulated',checks:['unverified creation rejected without database writes','one admission per check','direct WebSocket bypass from another IP rejected','replayed verification rejected','paused entry and admin authorization','connected recheck accepted','approved-only admission','mode and approvals survive restart','old passes rejected after restart','browser creation, town join and recheck','desktop portrait and landscape entry and admin UI']},null,2));
 console.log('PASS: admission HTTP, real game sockets, PostgreSQL restart and responsive browser flow (simulated challenge provider).');
}catch(error){if(browser){const page=browser.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});await writeFile(`${out}/failure-text.txt`,await page.locator('body').innerText().catch(()=>''));}}console.error(error instanceof Error?error.message:'Admission check failed');await writeFile(`${out}/server.log`,logs.replaceAll(key,'[redacted]').replaceAll(password,'[redacted]').replaceAll(passwordHash,'[redacted]').replaceAll(isolated.toString(),'[redacted]'));throw error;}
finally{await browser?.close();await web?.close();for(const room of rooms)if(room.connection?.isOpen)await Promise.race([room.leave().catch(()=>{}),delay(2000)]);await stop();await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}
