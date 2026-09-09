import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SalaryTracker } from '../server/salary.ts';
import { STARTER_OUTFIT, type WalletState } from '../shared/catalog.ts';
const state:WalletState={balance:1000,revision:1,salaryProgressMs:0,owned:Object.values(STARTER_OUTFIT),outfit:STARTER_OUTFIT};
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('salary hides immediately, grants a frozen client only its lease and discards server sleep',async()=>{
 let now=0;const checkpoints:number[]=[];
 const tracker=new SalaryTracker({async openSession(){return state;},async checkpoint(_id,_epoch,ms){checkpoints.push(ms);return state;}},{now:()=>now,autoTick:false,onSnapshot(){}});
 await tracker.start('profile','session','room');now=1000;tracker.tick();await settle();assert.deepEqual(checkpoints,[]);
 tracker.heartbeat('session',true);now=6000;tracker.tick();await settle();assert.equal(checkpoints.at(-1),5000);
 now=7000;tracker.heartbeat('session',false);await settle();assert.equal(checkpoints.at(-1),6000);
 now=100000;tracker.tick();await settle();assert.equal(checkpoints.at(-1),6000);
 tracker.heartbeat('session',true);
 for(now=101000;now<=115000;now+=1000){tracker.tick();await settle();}
 assert.equal(checkpoints.at(-1),16000);
 tracker.heartbeat('session',true);now+=100000;tracker.tick();await settle();assert.equal(checkpoints.at(-1),16000);
 await tracker.stop('session');assert.equal(checkpoints.at(-1),16000);await tracker.dispose();
});
test('leave freezes before in-flight persistence and coalesces later checkpoints',async()=>{
 let now=0;let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});const checkpoints:number[]=[];
 const tracker=new SalaryTracker({async openSession(){return state;},async checkpoint(_id,_epoch,ms){checkpoints.push(ms);if(checkpoints.length===1)await blocked;return state;}},{now:()=>now,autoTick:false,onSnapshot(){}});
 await tracker.start('profile','session','room');tracker.heartbeat('session',true);now=5000;tracker.tick();
 now=6500;const stopped=tracker.stop('session');now=500000;tracker.heartbeat('session',true);tracker.tick();release();await stopped;
 assert.deepEqual(checkpoints,[5000,6500]);await tracker.dispose();
});
test('salary threshold checkpoints early and failed writes retry cumulative time',async()=>{
 let now=0,fail=true;const checkpoints:number[]=[];let errors=0;
 const tracker=new SalaryTracker({async openSession(){return {...state,salaryProgressMs:599000};},async checkpoint(_id,_epoch,ms){checkpoints.push(ms);if(fail){fail=false;throw new Error('offline');}return {...state,balance:1100,salaryProgressMs:ms-1000};}},{now:()=>now,autoTick:false,onSnapshot(){},onError(){errors++;}});
 await tracker.start('profile','session','room');tracker.heartbeat('session',true);now=1000;tracker.tick();await settle();assert.equal(errors,1);assert.deepEqual(checkpoints,[1000]);
 now=2000;tracker.tick();await settle();assert.deepEqual(checkpoints,[1000,2000]);await tracker.stop('session');await tracker.dispose();
});
