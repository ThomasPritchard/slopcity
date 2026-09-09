import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mountEconomyRoutes } from '../server/economy.ts';
import { EconomyError,type EconomyRepository } from '../server/persistence/economy.ts';
import type { GuestRepository } from '../server/persistence/guests.ts';
test('economy mutations enforce origin, guest authentication, shop eligibility and usable conflict snapshots',async()=>{
 let purchases=0,allowed=false;
 const economy={async purchase(_id:string,_item:string,request:string,canPurchase:()=>boolean){if(request==='committed-request')return {balance:780};if(!canPurchase())throw new EconomyError('outside_shop','Visit Form & Thread to buy clothing');purchases++;throw new EconomyError('insufficient_funds','More credits needed',409,{balance:0} as never);}} as unknown as EconomyRepository;
 const guests={async resolve(){return {id:'profile'};}} as unknown as GuestRepository;
 const app=express();mountEconomyRoutes(app,guests,economy,{canPurchase:()=>allowed,onEquipped(){}});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as {port:number};
 const url=`http://127.0.0.1:${address.port}/api/economy/purchase`;
 const headers={Origin:process.env.APP_ORIGIN??'http://localhost:5173',Cookie:`slop_guest=${randomBytes(32).toString('base64url')}`,'Content-Type':'application/json'};
 const body=JSON.stringify({itemId:'oat-knit',requestId:'request-id',price:0});
 try{
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'http://evil.invalid'},body})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,Cookie:''},body})).status,401);
  const denied=await fetch(url,{method:'POST',headers,body});assert.equal(denied.status,409);assert.equal((await denied.json()).code,'outside_shop');assert.equal(purchases,0);
  const replay=await fetch(url,{method:'POST',headers,body:JSON.stringify({itemId:'oat-knit',requestId:'committed-request'})});assert.equal(replay.status,200);assert.deepEqual(await replay.json(),{balance:780});assert.equal(purchases,0);
  allowed=true;const conflict=await fetch(url,{method:'POST',headers,body});assert.equal(conflict.status,409);assert.deepEqual(await conflict.json(),{code:'insufficient_funds',error:'More credits needed',snapshot:{balance:0}});assert.equal(purchases,1);
 }finally{server.close();await once(server,'close');}
});
