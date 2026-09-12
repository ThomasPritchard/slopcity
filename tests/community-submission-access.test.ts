import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import sharp from 'sharp';
import { mountCommunityRoutes } from '../server/community.ts';
import { AdmissionService } from '../server/admission.ts';
import { CommunityAdminSessions } from '../server/communityAuth.ts';
import { CommunityError, type CommunityRepository, type ProtectedSubmissionInput } from '../server/persistence/community.ts';
import type { GuestRepository } from '../server/persistence/guests.ts';
import type { AccountRepository } from '../server/persistence/accounts.ts';
import type { AdmissionRepository } from '../server/persistence/admission.ts';
import type { SubmissionProtectionSnapshot } from '../shared/submissionProtection.ts';

async function fixture() {
 const app=express(), sessions=new CommunityAdminSessions();
 const profiles=new Map<string,{id:string}>(),members=new Set<string>();
 const writes:ProtectedSubmissionInput[]=[], checks:Array<{token:unknown;action:unknown}>=[];
 const receipts=new Map<string,{hash:string;status:number;body:{error:string}}>();
 let state:SubmissionProtectionSnapshot={pending:0,reasons:[],manualPaused:false,backlogPaused:false,accountCooldowns:[],networkCooldowns:[],spamPauseUntil:null,trialUntil:null,history:[]};
 const admission=new AdmissionService({siteKey:'fixture',secret:'fixture',hostnames:['localhost']},{} as AdmissionRepository,async(_url,init)=>{
  const body=JSON.parse(String(init?.body));checks.push({token:body.response,action:body.response==='town'?'town_entry':'community_upload'});
  if(body.response==='outage')throw new Error('Fixture provider outage');
  return new Response(JSON.stringify({success:body.response==='upload'||body.response==='town',hostname:'localhost',action:body.response==='town'?'town_entry':'community_upload'}),{status:200});
 });
 const repository={
  protectionStatus:async()=>state,
  replay:async(owner:string,id:string,hash:string)=>{const entry=receipts.get(`${owner}/${id}`);if(!entry)return null;if(entry.hash!==hash)throw new CommunityError('Different content',409);return {status:entry.status,body:entry.body};},
  submitProtected:async(input:ProtectedSubmissionInput)=>{writes.push(input);return {status:input.invalid?input.invalidStatus??400:201,body:input.invalid?{error:input.invalid}:{id:randomUUID(),status:'pending'}};},
 } as unknown as CommunityRepository;
 mountCommunityRoutes(app,{resolve:async(secret:string)=>profiles.get(secret)??null} as unknown as GuestRepository,repository,{adminSessions:sessions,accounts:{status:async(id:string)=>({kind:members.has(id)?'member':'guest'})} as unknown as AccountRepository,admission});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');
 const imageBase64=(await sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer()).toString('base64');
 const body=()=>({requestId:randomUUID(),title:'Picture',credit:'',imageBase64,turnstileToken:'upload' as unknown});
 return {
  body,writes,checks,receipts,
  account(member=true){const secret=randomBytes(32).toString('base64url'),id=randomUUID();profiles.set(secret,{id});if(member)members.add(id);return {id,cookie:`slop_guest=${secret}`};},
  admin:()=>sessions.cookie(sessions.create(),false),
  state:(patch:Partial<SubmissionProtectionSnapshot>)=>{state={...state,...patch};},
  async upload(cookie:string,payload:unknown=body(),ip='198.51.100.1',raw=false){const response=await fetch(`http://127.0.0.1:${address.port}/api/community/submissions`,{method:'POST',headers:{cookie,origin:process.env.APP_ORIGIN??'http://localhost:5173','content-type':'application/json','x-slop-client-ip':ip},body:raw?String(payload):JSON.stringify(payload)});return {status:response.status,body:await response.json()};},
  close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())),
 };
}
test('guest submissions rejected before JSON parsing, challenges and upload quota charging',async()=>{
 const f=await fixture();try{const guest=f.account(false);
  for(let n=0;n<125;n++)assert.equal((await f.upload(guest.cookie,'{',undefined,true)).status,403);
  assert.equal(f.checks.length,0);assert.equal(f.writes.length,0);
  assert.equal((await f.upload(f.account().cookie)).status,201);
 }finally{await f.close();}
});
test('member and administrator uploads require upload-specific challenge; town, missing and provider failures rejected',async()=>{
 const f=await fixture();try{
  for(const cookie of [f.account().cookie,f.admin()]) {
   for(const [token,status] of [['town',403],[undefined,403],['outage',503]] as const)assert.equal((await f.upload(cookie,{...f.body(),turnstileToken:token})).status,status);
   assert.equal((await f.upload(cookie)).status,201);
  }
  assert.equal(f.writes.length,2);assert.equal(f.writes[0]?.admin,false);assert.equal(f.writes[1]?.admin,true);assert.equal(f.writes[1]?.owner,null);
 }finally{await f.close();}
});
test('receipt replay skips challenge and normalization while changed payload returns conflict',async()=>{
 const f=await fixture();try{const member=f.account(),payload={...f.body(),imageBase64:'not an image',turnstileToken:undefined};
  const hash=createHash('sha256').update(JSON.stringify([payload.title,payload.credit,payload.imageBase64])).digest('hex');
  f.receipts.set(`${member.id}/${payload.requestId}`,{hash,status:400,body:{error:'Original result'}});
  assert.deepEqual(await f.upload(member.cookie,payload),{status:400,body:{error:'Original result'}});
  assert.equal((await f.upload(member.cookie,{...payload,title:'Changed'})).status,409);
  assert.equal(f.checks.length,0);assert.equal(f.writes.length,0);
 }finally{await f.close();}
});
test('pause and account/network cooldowns prevent provider work; admin remains available',async()=>{
 const f=await fixture();try{const member=f.account();
  f.state({reasons:['manual']});assert.equal((await f.upload(member.cookie)).status,429);
  f.state({reasons:[],accountCooldowns:[{key:member.id,until:Date.now()+60000}]});assert.equal((await f.upload(member.cookie)).status,429);
  f.state({accountCooldowns:[],networkCooldowns:[{key:'198.51.100.1',until:Date.now()+60000}]});assert.equal((await f.upload(member.cookie)).status,429);
  assert.equal(f.checks.length,0);assert.equal(f.writes.length,0);
  assert.equal((await f.upload(f.admin())).status,201);
 }finally{await f.close();}
});
test('invalid normalized image is passed to atomic protection recording after challenge',async()=>{
 const f=await fixture();try{const member=f.account();assert.equal((await f.upload(member.cookie,{...f.body(),imageBase64:'not-image'})).status,400);
  assert.equal(f.checks.length,1);assert.equal(f.writes.length,1);assert.equal(f.writes[0]?.image,undefined);assert.ok(f.writes[0]?.invalid);assert.equal(f.writes[0]?.owner,member.id);
 }finally{await f.close();}
});
