import assert from 'node:assert/strict';
import test from 'node:test';
import { move,parseInput,isWalkable,canHopAt,hasBodyClearance } from '../shared/world.ts';
import { hopHeight,HOP_HEIGHT,HOP_DURATION_MS,SPRINT_MULTIPLIER } from '../shared/mobility.ts';
test('sprint scales normalized movement and malformed sprint values are rejected',()=>{
 const start={x:0,z:-17},walk=move(start,{x:1,z:0},.1),run=move(start,{x:1,z:0,sprint:true},.1);
 assert.ok(Math.abs(run.x/walk.x-SPRINT_MULTIPLIER)<1e-9);
 assert.equal(parseInput({x:1,z:0,seq:1,sprint:99}),null);
 assert.deepEqual(move(start,{x:1,z:0,sprint:true},100),run);
});
test('hopping has bounded height and cannot cross solid walls even while sprinting',()=>{
 assert.equal(hopHeight(1000,999),0);assert.equal(hopHeight(1000,1000+HOP_DURATION_MS/2),HOP_HEIGHT);assert.equal(hopHeight(1000,1000+HOP_DURATION_MS),0);
 let p={x:17,z:4};for(let i=0;i<50;i++)p=move(p,{x:1,z:0,sprint:true},1,true);
 assert.ok(p.x<18);assert.ok(isWalkable(p.x,p.z));
});
test('hop admission and travel preserve bench and overhead clearance',()=>{
 assert.equal(canHopAt(-10,-7),false,'cannot rise through a bench');
 assert.equal(canHopAt(-10,-5.8),true,'clear space in front of a bench');
 let p={x:-10,z:-5.8};for(let i=0;i<20;i++)p=move(p,{x:0,z:-1,sprint:true},.1,true);
 assert.ok(p.z>=-6.28,'airborne motion cannot enter the bench');
 assert.equal(hasBodyClearance(7,21.5),true,'standing fits beneath the ramp lintel');
 assert.equal(hasBodyClearance(7,21.5,.8),false,'head volume is bounded by the lintel');
});
