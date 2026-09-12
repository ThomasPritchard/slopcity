import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import sharp from 'sharp';
import type { AdmissionService } from '../server/admission.ts';
import type { AccountRepository } from '../server/persistence/accounts.ts';
import { mountCommunityRoutes } from '../server/community.ts';
import { hashCommunityPassword } from '../server/communityAuth.ts';
import type { GuestRepository } from '../server/persistence/guests.ts';
import type { CommunityRepository } from '../server/persistence/community.ts';
test('community HTTP guards origin/admin, private media, login limits and admin uploads',async()=>{
 const app=express(),id='11111111-1111-4111-8111-111111111111';let submitted=false;
 const guests={resolve:async()=>({id})} as unknown as GuestRepository;
 const repo={programme:async()=>({images:[]}),list:async()=>[],image:async(_id:string,access:any)=>access.admin||access.owner===id?Buffer.from('image'):undefined,replay:async()=>null,protectionStatus:async()=>({pending:0,reasons:[],accountCooldowns:[],networkCooldowns:[],spamPauseUntil:null,trialUntil:null}),submitProtected:async(input:{owner:string|null;admin:boolean})=>{assert.equal(input.owner,null);assert.equal(input.admin,true);submitted=true;return {status:201,body:{id,status:'pending'}};}} as unknown as CommunityRepository;
 mountCommunityRoutes(app,guests,repo,{passwordHash:await hashCommunityPassword('test password long'),accounts:{status:async()=>({kind:'member'})} as unknown as AccountRepository,admission:{enabled:true,config:{siteKey:'fixture'},verify:async(token:unknown,_ip:string,action:string)=>{assert.equal(token,'upload-check');assert.equal(action,'community_upload');return 0;}} as unknown as AdmissionService});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}/api/community`;const headers={origin:process.env.APP_ORIGIN??'http://localhost:5173','content-type':'application/json'};
 const post=(path:string,body:unknown,extra:Record<string,string>={})=>fetch(url+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
 try{assert.equal((await fetch(url+'/programme')).status,200);assert.equal((await fetch(url+'/admin')).status,401);assert.equal((await fetch(url+`/images/${id}`)).status,404);assert.equal((await fetch(url+`/submissions/${id}/image`)).status,401);assert.equal((await post('/submissions',{})).status,401);assert.equal((await post('/admin/login',{password:'test password long'},{origin:'https://evil.invalid'})).status,403);const login=await post('/admin/login',{password:'test password long'});assert.equal(login.status,204);const cookie=login.headers.get('set-cookie')!.split(';')[0];assert.equal((await fetch(url+'/admin',{headers:{cookie}})).status,200);const imageBase64=(await sharp({create:{width:10,height:10,channels:3,background:'red'}}).png().toBuffer()).toString('base64');assert.equal((await post('/submissions',{requestId:id,turnstileToken:'upload-check',title:'Promo',credit:'',imageBase64},{cookie})).status,201);assert.ok(submitted);const media=await fetch(url+`/submissions/${id}/image`,{headers:{cookie}});assert.equal(media.status,200);assert.equal(media.headers.get('cache-control'),'private, no-store');assert.equal((await post('/admin/logout',{}, {cookie})).status,204);assert.equal((await fetch(url+'/admin',{headers:{cookie}})).status,401);for(let i=0;i<4;i++)assert.equal((await post('/admin/login',{password:'bad'})).status,401);assert.equal((await post('/admin/login',{password:'bad'})).status,429);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

test('community resolves Twitch detection without changing saved settings or programme revision',async()=>{
 const { CommunityAdminSessions }=await import('../server/communityAuth.ts');
 const { BRIDGEMIND_TWITCH_CHANNEL,communityImages }=await import('../shared/community.ts');
 const app=express(),sessions=new CommunityAdminSessions();
 const cookie=sessions.cookie(sessions.create(),false).split(';')[0];
 let stored:import('../shared/community.ts').Programme={revision:42,epochMs:100,serverNowMs:1000,mode:'live',platform:'twitch',twitchChannel:BRIDGEMIND_TWITCH_CHANNEL,youtubeVideoId:'kP31sQPAJm0',schedule:[{id:'show',title:'Community show',platform:'twitch',startsAt:'2026-10-01T19:00:00.000Z'}],images:communityImages([])};
 let detection:import('../server/twitchLive.ts').TwitchLiveSnapshot={status:'unconfigured',isLive:null,checkedAt:null,streamId:null};
 let writes=0;
 const repo={programme:async()=>stored,list:async()=>[],update:async(settings:import('../shared/community.ts').ProgrammeSettings,revision:number)=>{assert.equal(revision,stored.revision);writes++;stored={...stored,...settings,revision:stored.revision+1};return stored;}} as unknown as CommunityRepository;
 mountCommunityRoutes(app,{} as GuestRepository,repo,{adminSessions:sessions,twitchLive:{snapshot:()=>({...detection})}});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}/api/community`;
 const get=async()=>{const response=await fetch(url+'/programme');assert.equal(response.status,200);return response.json();};
 try{
  let programme=await get();assert.equal(programme.mode,'intermission');assert.deepEqual(programme.liveDetection,{status:'unconfigured',checkedAt:null});
  for(const status of ['checking','unknown'] as const){detection={...detection,status};assert.equal((await get()).mode,'intermission');}
  detection={status:'live',isLive:true,checkedAt:2000,streamId:'broadcast'};
  programme=await get();assert.equal(programme.mode,'live');assert.equal(programme.platform,'twitch');assert.equal(programme.twitchChannel,BRIDGEMIND_TWITCH_CHANNEL);
  assert.equal(programme.revision,42);assert.equal(programme.epochMs,100);assert.deepEqual(programme.images,stored.images);assert.deepEqual(programme.schedule,stored.schedule);assert.equal('streamId' in programme.liveDetection,false);
  detection={...detection,status:'unknown',checkedAt:3000};assert.equal((await get()).mode,'live');
  detection={status:'offline',isLive:false,checkedAt:4000,streamId:null};programme=await get();assert.equal(programme.mode,'intermission');assert.equal(programme.revision,42);assert.equal(writes,0);assert.equal(stored.mode,'live');
  stored={...stored,mode:'live',platform:'youtube'};assert.equal((await get()).platform,'youtube');assert.equal((await get()).mode,'live');
  detection={status:'live',isLive:true,checkedAt:5000,streamId:'new-broadcast'};
  const admin=await (await fetch(url+'/admin',{headers:{cookie}})).json();assert.equal(admin.programme.platform,'twitch');assert.equal(admin.settings.platform,'youtube');assert.equal(admin.settings.mode,'live');assert.equal('images' in admin.settings,false);
  const response=await fetch(url+'/admin/programme',{method:'PUT',headers:{cookie,origin:process.env.APP_ORIGIN??'http://localhost:5173','content-type':'application/json'},body:JSON.stringify({...admin.settings,mode:'intermission',expectedRevision:42})});assert.equal(response.status,200);programme=await response.json();assert.equal(programme.mode,'live');assert.equal(programme.platform,'twitch');assert.equal(programme.revision,43);assert.equal(stored.mode,'intermission');assert.equal(stored.platform,'youtube');assert.equal(writes,1);
  const updated=await (await fetch(url+'/admin',{headers:{cookie}})).json();assert.equal(updated.settings.mode,'intermission');assert.equal(updated.programme.mode,'live');
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
