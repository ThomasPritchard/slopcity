import assert from 'node:assert/strict';
import test from 'node:test';
import { SharedEmotes,emotePlacement,type EmoteCitizen } from '../server/emotes.ts';
import type { EmoteInbox } from '../shared/emotes.ts';
function fixture(){
 let now=100000;const players=new Map<string,EmoteCitizen>();
 for(const [id,x] of [['a',-3.15],['b',-2.25],['c',5]] as const)players.set(id,{profileId:id,name:id,x,z:-17,heading:0,seatId:'',jumpAt:0,moving:false,sprinting:false,emoteId:'',emoteKind:'',emoteRole:0,emoteAt:0});
 const inbox=new Map<string,EmoteInbox>(),busy=new Set<string>();let blocked=false;
 const emotes=new SharedEmotes({players:()=>players,blocked:()=>blocked,busy:id=>busy.has(id),inbox:(id,value)=>inbox.set(id,value),notice:()=>{},stopInput:()=>{}},()=>now);
 const request=()=>{emotes.handle('a',{action:'request',targetId:'b',kind:'hug'});return inbox.get('b')?.incoming?.id;};
 return {players,inbox,busy,emotes,request,advance:(ms:number)=>{now+=ms;emotes.tick();},block:()=>{blocked=true;emotes.tick();}};
}
test('paired emotes require recipient consent and share one timeline; private invite and repeated accept',()=>{
 const f=fixture();const id=f.request();assert.ok(id);assert.equal(f.inbox.has('c'),false);
 f.emotes.handle('a',{action:'accept',id});f.emotes.handle('c',{action:'accept',id});assert.equal(f.players.get('a')!.emoteId,'');
 f.emotes.handle('b',{action:'accept',id});const a=f.players.get('a')!,b=f.players.get('b')!;
 assert.equal(a.emoteId,id);assert.equal(b.emoteId,id);assert.equal(a.emoteAt,b.emoteAt);assert.notEqual(a.emoteRole,b.emoteRole);
 const started=a.emoteAt;f.emotes.handle('b',{action:'accept',id});assert.equal(a.emoteAt,started);
 f.advance(4000);assert.equal(a.emoteId,'');assert.equal(b.emoteId,'');
});
test('emote pending and paired cleanup for busy, seats, blocks, leave, expiry and cancellation',()=>{
 for(const paired of [false,true])for(const reason of ['busy','seat','block','leave','expiry','cancel']){
  const f=fixture(),id=f.request();assert.ok(id);if(paired)f.emotes.handle('b',{action:'accept',id});
  if(reason==='busy')f.busy.add('b');if(reason==='seat')f.players.get('b')!.seatId='bench';
  if(reason==='block')f.block();if(reason==='leave'){f.players.delete('b');f.emotes.leave('b');}
  if(reason==='cancel')f.emotes.handle('a',{action:'cancel'});f.advance(reason==='expiry'?13000:1);
  assert.equal(f.players.get('a')!.emoteId,'',`${paired} ${reason}`);assert.equal(f.inbox.get('a')?.outgoing,null);
  f.emotes.handle('b',{action:'accept',id});assert.equal(f.players.get('a')!.emoteId,'');
 }
});
test('emotes reject self, seated, hopping, busy, distant, blocked and repeated requests',()=>{
 for(const reason of ['self','seat','hop','busy','far','block']){
  const f=fixture();if(reason==='seat')f.players.get('b')!.seatId='seat';if(reason==='hop')f.players.get('b')!.jumpAt=99900;if(reason==='busy')f.busy.add('b');if(reason==='far')f.players.get('b')!.x=10;if(reason==='block')f.block();
  f.emotes.handle('a',{action:'request',targetId:reason==='self'?'a':'b',kind:'hug'});assert.equal(f.inbox.get('b')?.incoming,undefined);
 }
 const f=fixture(),id=f.request();f.request();assert.equal(f.inbox.get('b')!.incoming!.id,id);
});
test('paired placement rejects crowded, uneven and cramped paths',()=>{
 const a={x:-3.15,z:-17},b={x:-2.25,z:-17};
 assert.ok(emotePlacement(a,b,'hug',[]),'clear level placement');
 assert.equal(emotePlacement(a,b,'hug',[{x:-2.7,z:-17}]),null,'third player in the alignment path');
 assert.equal(emotePlacement({x:0,z:22.1},{x:0,z:22.8},'hug',[]),null,'different stair treads');
 assert.equal(emotePlacement({x:-25.8,z:-17},{x:-25.8,z:-16.1},'hug',[]),null,'arms beyond the town wall');
 assert.equal(emotePlacement({x:-10,z:-6.1},{x:-9.2,z:-6.1},'hug',[]),null,'arms would sweep through a bench');
});
