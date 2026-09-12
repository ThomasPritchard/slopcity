import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir,writeFile,rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import WebSocket from 'ws';
import type { Room } from '@colyseus/sdk';
import type { TownState } from '../shared/state.ts';
import { SALARY_INTERVAL_MS } from '../shared/catalog.ts';
import { creditActivityDates } from '../shared/creditProtection.ts';
import { preview } from 'vite';
import { chromium,type Browser,type Page } from 'playwright';
import { GuestRepository } from '../server/persistence/guests.ts';
import { EconomyRepository } from '../server/persistence/economy.ts';
import { CreditProtectionRepository,type ConfirmedGiftIncident } from '../server/persistence/creditProtection.ts';

// Real built UI + real game/WebSocket/API against a disposable local schema.
// Historical activity is a ledger fixture; no real player cookies or wallets are used.
globalThis.WebSocket=WebSocket as unknown as typeof globalThis.WebSocket;
const {Client}=await import('@colyseus/sdk');
const peers:Room<unknown,TownState>[]=[];
const source=new URL(process.env.DATABASE_URL!);
assert.ok(['localhost','127.0.0.1','[::1]'].includes(source.hostname),'Only the local development database is allowed');
const root=new Pool({connectionString:source.toString()}),schema=`credit_browser_${randomUUID().replaceAll('-','')}`;
await root.query(`CREATE SCHEMA ${schema}`);source.searchParams.set('options',`-c search_path=${schema}`);
const guests=new GuestRepository(source.toString()),economy=new EconomyRepository(guests.pool),protection=new CreditProtectionRepository(economy);
const port=5193,serverPort=2587,origin=`http://localhost:${port}`,output=resolve('output/playwright/credit-protection');
await mkdir(output,{recursive:true});
const incidentFile=resolve(`.local/${schema}-incidents.json`);
function startServer(file=''){
 const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'development',HOST:'127.0.0.1',PORT:String(serverPort),DATABASE_URL:source.toString(),APP_ORIGIN:origin,APP_ORIGINS:'',ABUSE_PROXY_SECRET:'',TURNSTILE_ENABLED:'false',TURNSTILE_SITE_KEY:'',TURNSTILE_SECRET_KEY:'',CREDIT_INCIDENTS_FILE:file,ACCOUNT_EMAIL_MODE:'disabled'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>{serverLog=(serverLog+chunk).slice(-8000);});child.stderr.on('data',chunk=>{serverLog=(serverLog+chunk).slice(-8000);});return child;
}
let serverLog='',server=startServer();
let web:Awaited<ReturnType<typeof preview>>|undefined,browser:Browser|undefined,page:Page|undefined;
const errors:string[]=[],checks:string[]=[];
async function until(check:()=>Promise<boolean>,label:string,timeout=20_000){const started=Date.now();while(!await check()){if(Date.now()-started>timeout)throw new Error(`Timed out: ${label}`);await delay(100);}}
async function historical(name:string,credits:number,baseBalance:number,date:string){
 const target=await guests.create({name,shirt:0,skin:0});await economy.ensure(target.profile.id);
 const sender=await guests.create({name:`Source ${name}`,shirt:0,skin:0});await economy.ensure(sender.profile.id);
 const gifts:ConfirmedGiftIncident['gifts']=[];
 await economy.transaction(async c=>{
  if(baseBalance!==1000){await c.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,'fixture:other-earnings','grant',$2)",[target.profile.id,baseBalance-1000]);await c.query('UPDATE economy_wallets SET balance=$2,revision=revision+1 WHERE profile_id=$1',[target.profile.id,baseBalance]);}
  await c.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,'fixture:historical-salary','salary',$2)",[sender.profile.id,credits]);
  await c.query('UPDATE economy_wallets SET balance=balance+$2,revision=revision+1 WHERE profile_id=$1',[sender.profile.id,credits]);
  for(let remaining=credits;remaining>0;remaining-=Math.min(remaining,100)){
   const amount=Math.min(remaining,100),requestId=randomUUID();gifts.push({senderId:sender.profile.id,requestId});
   await c.query('INSERT INTO player_gifts(sender_id,request_id,target_id,amount,created_at) VALUES($1,$2,$3,$4,$5)',[sender.profile.id,requestId,target.profile.id,amount,`${date}T14:34:00Z`]);
   await c.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,$3,'gift_sent',-$4::integer),($2,$3,'gift_received',$4)",[sender.profile.id,target.profile.id,`gift:${sender.profile.id}:${requestId}`,amount]);
  }
  await c.query('UPDATE economy_wallets SET balance=balance-$2,gifting_allowance=gifting_allowance-$2,revision=revision+1 WHERE profile_id=$1',[sender.profile.id,credits]);
  await c.query('UPDATE economy_wallets SET balance=balance+$2,revision=revision+1 WHERE profile_id=$1',[target.profile.id,credits]);
 });
 const incident:ConfirmedGiftIncident={key:`fixture:${name.replaceAll(' ','-')}`,profileId:target.profile.id,detectedAt:'2026-09-12T16:33:09Z',expectedCredits:credits,gifts};
 return{...target,incident};
}
async function join(p:Page){
 await p.goto(origin);await p.getByRole('button',{name:'Choose your look',exact:true}).waitFor();
 assert.equal(await p.locator('dialog.credit-notice').count(),0,'No warning before connecting to the world');
 await p.getByRole('button',{name:'Choose your look',exact:true}).click();
 await p.getByRole('button',{name:'Join the square',exact:true}).click();
 await p.locator('dialog.account-entry-dialog').getByRole('button',{name:'Not yet',exact:true}).click();
 await p.locator('.wallet-hud').waitFor({state:'visible'});
}
try{
 await until(async()=>{if(server.exitCode!==null)throw new Error(`Isolated game stopped: ${serverLog}`);try{return(await fetch(`http://127.0.0.1:${serverPort}/health`)).ok;}catch{return false;}},'game startup');
 const am=await historical('am',9800,8090,'2026-09-12'),origami=await historical('origami',5000,900,'2026-09-11');
 const reset=await historical('Reset example',5000,0,'2026-09-11');
 await economy.transaction(async c=>{await c.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,'fixture:spent-gifts','purchase',-4100)",[reset.profile.id]);await c.query('UPDATE economy_wallets SET balance=balance-4100 WHERE profile_id=$1',[reset.profile.id]);});
 const ordinary=await guests.create({name:'Ordinary neighbour',shirt:0,skin:0});await economy.ensure(ordinary.profile.id);
 await mkdir(resolve('.local'),{recursive:true});await writeFile(incidentFile,JSON.stringify([am.incident,origami.incident,reset.incident]),{mode:0o600});
 server.kill('SIGTERM');await until(async()=>server.exitCode!==null,'fixture game stop');server=startServer(incidentFile);
 await until(async()=>{if(server.exitCode!==null)throw new Error(`Isolated game stopped: ${serverLog}`);try{return(await fetch(`http://127.0.0.1:${serverPort}/health`)).ok;}catch{return false;}},'incident application before listening');
 assert.equal((await economy.ensure(am.profile.id)).balance,8090);assert.equal((await economy.ensure(origami.profile.id)).balance,900);
 checks.push('Real game startup applies the configured exact-gift incident file before admitting world connections');
 web=await preview({configFile:false,root:process.cwd(),preview:{host:'127.0.0.1',port,strictPort:true,proxy:{'/game':{target:`http://127.0.0.1:${serverPort}`,ws:true,rewrite:path=>path.replace(/^\/game/,'')}}}});
 browser=await chromium.launch({headless:true,args:[...(process.platform==='darwin'?['--use-angle=metal']:[]),'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.addInitScript(()=>{localStorage.setItem('slop-city-comfort',JSON.stringify({graphics:'low',motion:'reduced',effects:0,ambience:0}));if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw new Error('Microphone disabled in credit notice test');};});
 await context.addCookies([{name:'slop_guest',value:am.secret,domain:'localhost',path:'/game',httpOnly:true,sameSite:'Strict'}]);
 page=await context.newPage();page.setDefaultTimeout(60_000);page.on('pageerror',error=>errors.push(error.message));
 await join(page);const dialog=page.getByRole('dialog',{name:'Suspicious gift activity',exact:true});await dialog.waitFor();
 await dialog.getByText('12 September 2026',{exact:true}).waitFor();assert.ok((await dialog.innerText()).includes('9,800'));assert.equal((await economy.ensure(am.profile.id)).balance,8090);
 assert.equal(await page.evaluate(()=>document.querySelector('dialog.credit-notice')?.matches(':modal')),true);
 await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true);await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.querySelector('dialog.credit-notice')?.contains(document.activeElement)),true);
 for(const[label,width,height]of[['desktop',1280,900],['portrait',390,844],['landscape',844,390]]as const){
  await page.setViewportSize({width,height});await delay(100);const box=await dialog.boundingBox();assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,`${label} fits`);
  const button=await dialog.getByRole('button',{name:'I understand',exact:true}).boundingBox();assert.ok(button&&button.height>=44&&button.y+button.height<=height,`${label} acknowledgement remains visible`);
  const activityDate=await dialog.locator('.credit-notice-date').boundingBox();assert.ok(activityDate&&activityDate.y>=0&&activityDate.y+activityDate.height<=height,`${label} activity date is visible without scrolling`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`${output}/am-${label}.png`});
 }
 checks.push('Real world connection opens a private native modal with 9,800 credits and the 12 September activity date; portrait/short landscape fit, keyboard focus and Escape behaviour');
 let attempts=0;
 await page.route('**/game/api/economy/notices/acknowledge',async route=>{attempts++;if(attempts===1)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture failure'})});else if(attempts===2){await route.fetch();await route.abort('failed');}else await route.continue();});
 await dialog.getByRole('button',{name:'I understand',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.equal((await protection.pending(am.profile.id)).length,1);
 await dialog.getByRole('button',{name:'I understand',exact:true}).click();await until(async()=>(await protection.pending(am.profile.id)).length===0,'committed lost acknowledgement');await dialog.getByRole('alert').waitFor();
 await dialog.getByRole('button',{name:'I understand',exact:true}).click();await dialog.waitFor({state:'detached'});await page.unroute('**/game/api/economy/notices/acknowledge');
 await join(page);await until(async()=>await page!.evaluate(async()=>(await(await fetch('/game/api/economy/notices')).json()).notices.length===0),'empty notices after reconnect');assert.equal(await dialog.count(),0);assert.equal((await economy.ensure(am.profile.id)).balance,8090);
 checks.push('Failed acknowledgement remains pending; lost committed response safely retries; acknowledgement survives a real reconnect with no repeated modal or deduction');
 await context.close();
 const second=await browser.newContext({viewport:{width:1280,height:900}});await second.addCookies([{name:'slop_guest',value:origami.secret,domain:'localhost',path:'/game',httpOnly:true,sameSite:'Strict'}]);
 page=await second.newPage();page.setDefaultTimeout(60_000);page.on('pageerror',error=>errors.push(error.message));await join(page);
 const otherDialog=page.getByRole('dialog',{name:'Suspicious gift activity',exact:true});await otherDialog.waitFor();await otherDialog.getByText('11 September 2026',{exact:true}).waitFor();assert.equal(await otherDialog.getByText('12 September 2026',{exact:true}).count(),0);assert.ok((await otherDialog.innerText()).includes('5,000'));
 await page.screenshot({path:`${output}/origami-desktop.png`});await otherDialog.getByRole('button',{name:'I understand',exact:true}).click();await otherDialog.waitFor({state:'detached'});await second.close();
 checks.push('Origami sees 5,000 credits and 11 September, the activity date rather than the 12 September detection date');
 const third=await browser.newContext();await third.addCookies([{name:'slop_guest',value:ordinary.secret,domain:'localhost',path:'/game',httpOnly:true,sameSite:'Strict'}]);page=await third.newPage();page.setDefaultTimeout(60_000);await join(page);
 const ordinaryNotices=await page.evaluate(async()=>(await(await fetch('/game/api/economy/notices')).json()).notices);assert.deepEqual(ordinaryNotices,[]);assert.equal(await page.locator('dialog.credit-notice').count(),0);await third.close();
 checks.push('An unrelated player joins normally and cannot see another player’s notices');
 const resetContext=await browser.newContext({viewport:{width:1280,height:900}});await resetContext.addCookies([{name:'slop_guest',value:reset.secret,domain:'localhost',path:'/game',httpOnly:true,sameSite:'Strict'}]);page=await resetContext.newPage();page.setDefaultTimeout(60_000);page.on('pageerror',error=>errors.push(error.message));await join(page);
 const resetDialog=page.getByRole('dialog',{name:'Suspicious gift activity',exact:true});await resetDialog.waitFor();
 assert.equal((await economy.ensure(reset.profile.id)).balance,1000);assert.ok((await resetDialog.innerText()).includes('You have nothing left to repay.'));assert.ok((await resetDialog.locator('.credit-notice-reset').innerText()).includes('starting amount of 1,000 credits'));
 for(const[label,width,height]of[['desktop',1280,900],['portrait',390,844],['landscape',844,390]]as const){
  await page.setViewportSize({width,height});await delay(100);
  for(const locator of [resetDialog,resetDialog.locator('.credit-notice-date'),resetDialog.locator('.credit-notice-reset'),resetDialog.getByRole('button',{name:'I understand',exact:true})]){const box=await locator.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=height+1,`${label}: reset, date and acknowledgement visible`);}
  await page.screenshot({path:`${output}/reset-${label}.png`});
 }
 await resetDialog.getByRole('button',{name:'I understand',exact:true}).click();await resetDialog.waitFor({state:'detached'});await resetContext.close();
 checks.push('A 5,000-credit deduction against a 900-credit wallet resets to 1,000; clear no-debt message, activity date and acknowledgement visible on desktop, portrait and short landscape');
 // A real automatic trigger: five new authenticated donors, production salary writes
 // with fixture eligible time, real town presence and real gift HTTP requests.
 const recipient=await guests.create({name:'Automatic example',shirt:0,skin:0});await economy.ensure(recipient.profile.id);
 const donors:Awaited<ReturnType<GuestRepository['create']>>[]=[];
 for(let i=0;i<5;i++){const donor=await guests.create({name:`Automatic donor ${i}`,shirt:0,skin:0});await economy.ensure(donor.profile.id);const epoch=randomUUID();await economy.openSession(donor.profile.id,epoch);await economy.checkpoint(donor.profile.id,epoch,SALARY_INTERVAL_MS);donors.push(donor);}
 async function connectDonor(donor:typeof donors[number]){
  const room=await new Client(`http://127.0.0.1:${serverPort}`,{headers:{Cookie:`slop_guest=${donor.secret}`,Origin:origin}}).joinOrCreate<TownState>('town');peers.push(room);
  for(const name of ['voice-neighbours','notice','economy','emote-inbox','social-changed','economy-error','casino-state','casino-private','casino-receipt'])room.onMessage(name,()=>{});
  await until(async()=>!!room.state?.players?.has(room.sessionId),'donor joined');return room;
 }
 await connectDonor(donors[0]);await until(async()=>peers[0].state.players.size===1,'prior browser sessions left');await connectDonor(donors[1]);
 const automaticContext=await browser.newContext({viewport:{width:1280,height:900}});await automaticContext.addCookies([{name:'slop_guest',value:recipient.secret,domain:'localhost',path:'/game',httpOnly:true,sameSite:'Strict'}]);page=await automaticContext.newPage();page.setDefaultTimeout(60_000);page.on('pageerror',error=>errors.push(error.message));await join(page);
 for(const donor of donors.slice(2))await connectDonor(donor);
 await until(async()=>peers[0].state.players.size===6,'five donors and recipient');
 const requests=donors.map(()=>randomUUID());
 for(let i=0;i<donors.length;i++){
  const response=await fetch(`http://127.0.0.1:${serverPort}/api/social/gifts`,{method:'POST',headers:{Origin:origin,Cookie:`slop_guest=${donors[i].secret}`,'Content-Type':'application/json'},body:JSON.stringify({targetId:recipient.profile.id,amount:100,requestId:requests[i]})});
  assert.equal(response.status,200,`Real gift ${i+1}`);const receipt=await response.json();assert.equal(receipt.reversed,i===4);
 }
 assert.equal((await economy.ensure(recipient.profile.id)).balance,1000);const automaticNotice=(await protection.pending(recipient.profile.id))[0];assert.equal(automaticNotice.credits,500);
 assert.equal(await page.locator('dialog.credit-notice').count(),0,'Trigger waits for the next world connection');
 await join(page);const automaticDialog=page.getByRole('dialog',{name:'Suspicious gift activity',exact:true});await automaticDialog.waitFor();await automaticDialog.getByText(creditActivityDates(automaticNotice.activityStartedAt,automaticNotice.activityEndedAt),{exact:true}).waitFor();assert.ok((await automaticDialog.innerText()).includes('500'));
 await page.screenshot({path:`${output}/automatic-trigger-desktop.png`});await automaticDialog.getByRole('button',{name:'I understand',exact:true}).click();await automaticDialog.waitFor({state:'detached'});await automaticContext.close();
 checks.push('Five real nearby donor gifts automatically reverse 500 credits; recipient sees the shared modal on the next world connection with the recorded activity date');
 assert.deepEqual(errors,[]);
 await writeFile(`${output}/results.json`,JSON.stringify({checkedAt:new Date().toISOString(),checks,errors,limits:['Disposable local database with historical ledger fixtures; real built React UI, game WebSocket and API.','Headless desktop and emulated phone layouts; no production changes or physical-device proof.']},null,2));
 console.log(`PASS: ${checks.length} credit notice journeys; ${output}/results.json`);
}catch(error){await page?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}
finally{
 await Promise.allSettled(peers.map(room=>room.leave()));await browser?.close();await new Promise<void>(resolve=>web?web.httpServer.close(()=>resolve()):resolve());
 server.kill('SIGTERM');await until(async()=>server.exitCode!==null,'isolated game shutdown',30_000).catch(()=>server.kill('SIGKILL'));
 await guests.close();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();await rm(incidentFile,{force:true});
}
