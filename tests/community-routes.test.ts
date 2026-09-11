import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import sharp from 'sharp';
import { mountCommunityRoutes } from '../server/community.ts';
import { hashCommunityPassword } from '../server/communityAuth.ts';
import type { GuestRepository } from '../server/persistence/guests.ts';
import type { CommunityRepository } from '../server/persistence/community.ts';
test('community HTTP guards origin/admin, private media, login limits and admin uploads',async()=>{
 const app=express(),id='11111111-1111-4111-8111-111111111111';let submitted=false;
 const guests={resolve:async()=>({id})} as unknown as GuestRepository;
 const repo={programme:async()=>({images:[]}),list:async()=>[],image:async(_id:string,access:any)=>access.admin||access.owner===id?Buffer.from('image'):undefined,submit:async(owner:string|null)=>{assert.equal(owner,null);submitted=true;return {id,status:'pending'};}} as unknown as CommunityRepository;
 mountCommunityRoutes(app,guests,repo,{passwordHash:await hashCommunityPassword('test password long')});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}/api/community`;const headers={origin:process.env.APP_ORIGIN??'http://localhost:5173','content-type':'application/json'};
 const post=(path:string,body:unknown,extra:Record<string,string>={})=>fetch(url+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
 try{assert.equal((await fetch(url+'/programme')).status,200);assert.equal((await fetch(url+'/admin')).status,401);assert.equal((await fetch(url+`/images/${id}`)).status,404);assert.equal((await fetch(url+`/submissions/${id}/image`)).status,401);assert.equal((await post('/submissions',{})).status,401);assert.equal((await post('/admin/login',{password:'test password long'},{origin:'https://evil.invalid'})).status,403);const login=await post('/admin/login',{password:'test password long'});assert.equal(login.status,204);const cookie=login.headers.get('set-cookie')!.split(';')[0];assert.equal((await fetch(url+'/admin',{headers:{cookie}})).status,200);const imageBase64=(await sharp({create:{width:10,height:10,channels:3,background:'red'}}).png().toBuffer()).toString('base64');assert.equal((await post('/submissions',{title:'Promo',credit:'',imageBase64},{cookie})).status,201);assert.ok(submitted);const media=await fetch(url+`/submissions/${id}/image`,{headers:{cookie}});assert.equal(media.status,200);assert.equal(media.headers.get('cache-control'),'private, no-store');assert.equal((await post('/admin/logout',{}, {cookie})).status,204);assert.equal((await fetch(url+'/admin',{headers:{cookie}})).status,401);for(let i=0;i<4;i++)assert.equal((await post('/admin/login',{password:'bad'})).status,401);assert.equal((await post('/admin/login',{password:'bad'})).status,429);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
