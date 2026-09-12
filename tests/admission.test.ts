import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { AdmissionService, turnstileConfig } from '../server/admission.ts';
import type { AdmissionRepository } from '../server/persistence/admission.ts';

const config = {siteKey:'fixture-site',secret:'fixture-secret',hostnames:['localhost']};
const cookie = () => `slop_guest=${randomBytes(32).toString('base64url')}`;
function fixture(fetcher?: typeof fetch) {
 let now=1000, mode='open', approved:string[]=[];
 const records:{action:string;target:string}[]=[];
 const repository={initialise:async()=>{},load:async()=>({mode,approved}),approved:async()=>approved.map(id=>({id,name:'Guest'})),edit:async(action:string,target:string)=>{records.push({action,target});if(action==='mode')mode=target;if(action==='approve')approved.push(target);if(action==='revoke')approved=approved.filter(id=>id!==target);}} as unknown as AdmissionRepository;
 const used=new Set<string>();
 const provider:typeof fetch=fetcher??(async(input,options)=>{
  assert.equal(input,'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  const body=JSON.parse(String(options?.body));assert.equal(body.secret,'fixture-secret');assert.equal(body.remoteip,'198.51.100.1');assert.ok(body.idempotency_key);
  if(used.has(body.response))return Response.json({success:false,'error-codes':['timeout-or-duplicate']});
  used.add(body.response);return Response.json({success:true,hostname:'localhost',action:'town_entry'});
 });
 const service=new AdmissionService(config,repository,provider,()=>now);
 return {service,records,repository,advance:(ms:number)=>now+=ms};
}
test('public production fails closed on missing, partial or dummy keys; loopback smoke remains isolated',()=>{
 for(const pair of [{},{TURNSTILE_SITE_KEY:'key'},{TURNSTILE_SITE_KEY:'1x00000000000000000000AA',TURNSTILE_SECRET_KEY:'secret'}])assert.throws(()=>turnstileConfig({NODE_ENV:'production',APP_ORIGIN:'https://slopcity.fun',...pair}));
 assert.equal(turnstileConfig({NODE_ENV:'production',APP_ORIGIN:'https://game.localhost:8443'}).secret,'');
 assert.equal(turnstileConfig({NODE_ENV:'production',APP_ORIGIN:'https://slopcity.fun',TURNSTILE_SITE_KEY:'real-key',TURNSTILE_SECRET_KEY:'real-secret'}).siteKey,'real-key');
 assert.throws(()=>turnstileConfig({TURNSTILE_SECRET_KEY:'partial'}));
});
test('Turnstile can be disabled explicitly only in loopback development, retaining saved keys',()=>{
 const keys={TURNSTILE_SITE_KEY:'saved-site',TURNSTILE_SECRET_KEY:'saved-secret'};
 const local={APP_ORIGIN:'http://localhost:5173',APP_ORIGINS:'http://127.0.0.1:5173'};
 assert.deepEqual(turnstileConfig({...local,...keys,TURNSTILE_ENABLED:'false'}),{siteKey:'',secret:'',hostnames:['localhost','127.0.0.1']});
 assert.equal(turnstileConfig({...local,...keys,TURNSTILE_ENABLED:'true'}).secret,'saved-secret');
 assert.equal(turnstileConfig({...local,...keys}).secret,'saved-secret','unset retains existing configured verification');
 for(const TURNSTILE_ENABLED of ['true','yes','0','disabled'])assert.throws(()=>turnstileConfig({...local,TURNSTILE_ENABLED}),'enabled requires keys and invalid flags are rejected');
 for(const env of [
  {NODE_ENV:'production',APP_ORIGIN:'https://slopcity.fun'},
  {NODE_ENV:'production',APP_ORIGIN:'https://game.localhost:8443'},
  {APP_ORIGIN:'https://slopcity.fun'},
  {...local,APP_ORIGINS:'https://slopcity.fun'},
 ])assert.throws(()=>turnstileConfig({...env,...keys,TURNSTILE_ENABLED:'false'}),/only allowed for loopback development/);
});
test('disabled local verification skips the provider and passes, while entry restrictions still apply',async()=>{
 const {repository}=fixture();
 const service=new AdmissionService(turnstileConfig({TURNSTILE_ENABLED:'false'}),repository,async()=>{assert.fail('disabled verification must not call Cloudflare');});
 const id=randomUUID(),browser=cookie();await service.initialise();
 assert.deepEqual(service.status(),{enabled:false,siteKey:'',mode:'open',verified:false});
 await service.verify(undefined,'127.0.0.1');
 assert.equal(service.reserve(id,browser),undefined);
 assert.doesNotThrow(()=>service.checkUpgrade(id,browser));
 assert.doesNotThrow(()=>service.consume(id,browser));
 await service.edit('mode','paused');assert.throws(()=>service.reserve(id,browser),/paused/);
 await service.edit('mode','approved');assert.throws(()=>service.checkUpgrade(id,browser),/approved guests/);
 await service.edit('approve',id);assert.doesNotThrow(()=>service.consume(id,browser));
 await assert.rejects(()=>service.edit('reverify','all'),/Reverification requires Turnstile/);
});
test('Siteverify rejects malformed tokens, failure, wrong hostname/action and network outages',async()=>{
 for(const result of [{success:false},{success:true,hostname:'evil.invalid',action:'town_entry'},{success:true,hostname:'localhost',action:'another_form'},{success:true}]) {
  const {service}=fixture(async()=>Response.json(result));
  await assert.rejects(()=>service.verify('token','198.51.100.1'),/complete the entry check/);
 }
 const {service}=fixture(async()=>{throw new Error('network failed');});
 for(const token of [undefined,{},'', 'a'.repeat(2049)])await assert.rejects(()=>service.verify(token,'198.51.100.1'),/complete the entry check/);
 await assert.rejects(()=>service.verify('token','198.51.100.1'),/unavailable/);
});
test('verification is single-use and grants require the same guest credential through reservation and socket admission',async()=>{
 const {service,advance}=fixture(),id=randomUUID(),browser=cookie(),other=cookie();
 assert.throws(()=>service.reserve(id,browser));
 const generation=await service.verify('once','198.51.100.1');service.issue(id,browser,generation);
 assert.equal(service.status(id,browser).verified,true);assert.equal(service.status(id,other).verified,false);
 await assert.rejects(()=>service.verify('once','198.51.100.1'));
 assert.throws(()=>service.reserve(randomUUID(),browser));assert.throws(()=>service.reserve(id,other));assert.throws(()=>service.checkUpgrade(id,browser),'a reservation is required before upgrading');
 const reservation=service.reserve(id,browser);assert.ok(reservation);
 assert.throws(()=>service.reserve(id,browser),'cannot reserve a second slot with the same check');
 assert.throws(()=>service.consume(id,browser,'wrong'));assert.throws(()=>service.consume(id,other,reservation));
 service.consume(id,browser,reservation);assert.throws(()=>service.consume(id,browser,reservation),'socket replay rejected');
 service.issue(id,browser,generation);advance(15*60_000);assert.throws(()=>service.reserve(id,browser),'unused check expires');
 service.issue(id,browser,generation);const stale=service.reserve(id,browser);advance(30_000);assert.throws(()=>service.consume(id,browser,stale),'reservation expires');
});
test('raid controls persist, invalidate outstanding passes, and approval never bypasses verification',async()=>{
 const {service,repository}=fixture(),id=randomUUID(),browser=cookie();await service.initialise();
 const generation=await service.verify('check','198.51.100.1');service.issue(id,browser,generation);
 await service.edit('mode','paused');assert.throws(()=>service.checkMode());assert.throws(()=>service.reserve(id,browser));assert.throws(()=>service.issue(id,browser,generation));
 await service.edit('mode','approved');assert.throws(()=>service.reserve(id,browser),/approved guests/);
 await service.edit('approve',id);assert.throws(()=>service.reserve(id,browser),/entry check/);
 service.issue(id,browser,await service.verify('fresh','198.51.100.1'));assert.ok(service.reserve(id,browser));
 const restarted=new AdmissionService(config,repository);await restarted.initialise();assert.equal((await restarted.snapshot()).mode,'approved');assert.doesNotThrow(()=>restarted.checkMode(id));assert.throws(()=>restarted.reserve(id,browser),'grants do not survive a restart');
 await service.edit('revoke',id);assert.throws(()=>service.checkMode(id));
 await assert.rejects(()=>service.edit('mode','anything'));await assert.rejects(()=>service.edit('approve','not-an-id'));
});
test('connected viewers stay until the recheck deadline; success renews that connection without granting another slot',async()=>{
 const {service,advance}=fixture(),id=randomUUID(),browser=cookie(),second=randomUUID();let kicked=0,notices=0;
 service.connect('one',id,browser,()=>notices++,()=>kicked++);service.connect('two',second,cookie(),()=>notices++,()=>kicked++);
 advance(60*60_000);service.expire();assert.equal(kicked,0,'quiet cinema viewers are not bots');
 await service.edit('reverify','all');assert.equal(notices,2);
 await service.edit('mode','paused'); // Existing players can still finish their check.
 service.issue(id,browser,await service.verify('renew','198.51.100.1'));
 assert.equal(service.status(id,browser).verified,false,'no spare admission ticket');
 advance(120_000);service.expire();assert.equal(kicked,1);service.expire();assert.equal(kicked,1);
});
test('an in-flight response cannot satisfy a newer raid check; provider concurrency is bounded',async()=>{
 let resolve!: (r:Response)=>void;
 const {service}=fixture(()=>new Promise(r=>{resolve=r;}));
 const attempt=service.verify('old','198.51.100.1');await service.edit('reverify','all');resolve(Response.json({success:true,hostname:'localhost',action:'town_entry'}));await assert.rejects(()=>attempt);
 const responses:((r:Response)=>void)[]=[];
 const bounded=fixture(()=>new Promise(r=>responses.push(r))).service;
 const requests=Array.from({length:16},(_,i)=>bounded.verify(String(i),'198.51.100.1'));
 await assert.rejects(()=>bounded.verify('overflow','198.51.100.1'),/Too many/);
 responses.forEach(r=>r(Response.json({success:true,hostname:'localhost',action:'town_entry'})));await Promise.all(requests);
});
test('email and upload challenges require their own fresh action and cannot reuse entry verification', async () => {
 const used = new Set<string>();
 const { service } = fixture(async (_input, options) => {
  const token = JSON.parse(String(options?.body)).response as string;
  if (used.has(token)) return Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] });
  used.add(token);
  return Response.json({ success: true, hostname: 'localhost', action: token.split(':')[0] });
 });
 await service.verify('town_entry:one', '198.51.100.1');
 await assert.rejects(service.verify('town_entry:one', '198.51.100.1', 'account_email'));
 await assert.rejects(service.verify('town_entry:two', '198.51.100.1', 'account_email'));
 await service.verify('account_email:one', '198.51.100.1', 'account_email');
 await assert.rejects(service.verify('account_email:one', '198.51.100.1', 'community_upload'));
 await assert.rejects(service.verify('account_email:two', '198.51.100.1', 'community_upload'));
 await service.verify('account_entry:one', '198.51.100.1', 'account_entry');
 await assert.rejects(service.verify('account_entry:one', '198.51.100.1', 'account_entry'));
 await assert.rejects(service.verify('account_entry:two', '198.51.100.1', 'community_upload'));
 await assert.rejects(service.verify('account_entry:three', '198.51.100.1', 'account_email'));
 await assert.rejects(service.verify('account_entry:four', '198.51.100.1'));
 await service.verify('community_upload:one', '198.51.100.1', 'community_upload');
 await assert.rejects(service.verify('community_upload:one', '198.51.100.1', 'community_upload'));
});
test('account session invalidation clears target grants and disconnects matching connections once', async () => {
 const { service } = fixture(), target = randomUUID(), other = randomUUID(), targetCookie = cookie(), otherCookie = cookie();
 const generation = await service.verify('target-grant', '198.51.100.1');
 service.issue(target, targetCookie, generation); service.issue(other, otherCookie, generation);
 let targetDisconnects = 0, otherDisconnects = 0;
 service.connect('target-one', target, targetCookie, () => {}, () => { targetDisconnects++; });
 service.connect('target-two', target, cookie(), () => {}, () => { targetDisconnects++; });
 service.connect('other-one', other, otherCookie, () => {}, () => { otherDisconnects++; });
 service.invalidateProfiles([target, target]);
 assert.equal(targetDisconnects, 2); assert.equal(otherDisconnects, 0);
 assert.equal(service.status(target, targetCookie).verified, false);
 assert.equal(service.status(other, otherCookie).verified, true);
 assert.throws(() => service.reserve(target, targetCookie));
 service.invalidateProfiles([target]); assert.equal(targetDisconnects, 2);
 service.invalidateProfiles([other]); assert.equal(otherDisconnects, 1);
});
