import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { mountPlayerSocialRoutes, type SocialPresence } from '../server/playerSocial.ts';
import type { GuestRepository } from '../server/persistence/guests.ts';
import type { SocialRepository } from '../server/persistence/social.ts';
import { EconomyError } from '../server/persistence/economy.ts';

test('social HTTP protects cookies/origin/body, checks same-town proximity and rate limits',async()=>{
 const app=express();let giftCalls=0,friendCalls=0;
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
 const presence=new Map<string,SocialPresence>([[a,{roomId:'town',sessionId:'a',x:0,z:0}],[b,{roomId:'town',sessionId:'b',x:3,z:0}]]);
 const snapshot={friends:[],incoming:[],outgoing:[],giftingAllowance:100};
 const guests={resolve:async()=>({id:a})} as unknown as GuestRepository;
 const social={snapshot:async()=>snapshot,friend:async()=>{friendCalls++;},gift:async(_a:string,_b:string,_amount:number,_request:string,eligible:()=>boolean)=>{giftCalls++;if(!eligible())throw new EconomyError('not_nearby','Nearby required');return {replayed:false};}} as unknown as SocialRepository;
 mountPlayerSocialRoutes(app,guests,social,{presence:id=>presence.get(id),changed:()=>{},gifted:async()=>{}});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}/api/social`;
 const headers={cookie:`slop_guest=${'a'.repeat(43)}`,origin:process.env.APP_ORIGIN??'http://localhost:5173','content-type':'application/json'};
 const post=(path:string,body:unknown,extra:Record<string,string>={})=>fetch(url+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
 try{
  assert.equal((await fetch(url)).status,401);
  const state=await fetch(url,{headers});assert.equal(state.status,200);assert.equal(state.headers.get('cache-control'),'private, no-store');assert.deepEqual(await state.json(),snapshot);
  assert.equal((await post('/gifts',{}, {origin:'https://evil.invalid'})).status,403);assert.equal(giftCalls,0);
  assert.equal((await post('/gifts',{padding:'x'.repeat(3000)})).status,413);assert.equal(giftCalls,0);
  const gift={targetId:b,amount:1,requestId:'33333333-3333-4333-8333-333333333333'};
  assert.equal((await post('/gifts',gift)).status,200);
  presence.get(b)!.x=3.01;assert.equal((await post('/gifts',gift)).status,409);
  presence.get(b)!.x=0;presence.get(b)!.roomId='elsewhere';assert.equal((await post('/gifts',gift)).status,409);
  presence.delete(b);assert.equal((await post('/gifts',gift)).status,409);
  let last:Response|undefined;for(let i=0;i<60;i++)last=await post('/friends',{targetId:b,action:'request'});
  assert.equal(last!.status,429);assert.ok(last!.headers.get('retry-after'));assert.ok(friendCalls<=56);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
