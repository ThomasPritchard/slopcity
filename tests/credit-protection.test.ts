import assert from 'node:assert/strict';
import test from 'node:test';
import { creditActivityDates, giftFarmSenders, type GiftFarmSignal } from '../shared/creditProtection.ts';

const now=Date.parse('2026-09-12T13:45:00Z');
const group=(n=5):GiftFarmSignal[]=>Array.from({length:n},(_,i)=>({senderId:`profile-${i}`,profileCreatedAt:now-600_000+i*1000,giftedAt:now-i*1000,salaryEarned:100,salarySentToRecipient:100,hasOtherActivity:false}));
test('Automatic gift recovery requires every independent signal, never generosity or spam alone',()=>{
 assert.equal(giftFarmSenders(group(),now).length,5);
 assert.deepEqual(giftFarmSenders(group(1),now),[],'A player may gift 100% of salary');
 assert.deepEqual(giftFarmSenders(group(4),now),[],'Four donors do not meet the threshold');
 assert.deepEqual(giftFarmSenders(Array(50).fill(group(1)[0]),now),[],'Repeated gifts from one sender do not create a cohort');
 assert.deepEqual(giftFarmSenders(group().map((s,i)=>({...s,profileCreatedAt:now-600_000+i*40_000})),now),[],'Creation outside two minutes');
 assert.deepEqual(giftFarmSenders(group().map(s=>({...s,profileCreatedAt:s.giftedAt-1_800_001})),now),[],'Older donors are not punished');
 assert.deepEqual(giftFarmSenders(group().map((s,i)=>({...s,giftedAt:now-i*40_000})),now),[],'Gifts spread outside two minutes');
 assert.deepEqual(giftFarmSenders(group().map(s=>({...s,hasOtherActivity:true})),now),[],'Established economic activity excludes the donor');
 assert.deepEqual(giftFarmSenders(group().map(s=>({...s,salaryEarned:1000,salarySentToRecipient:799})),now),[]);
 assert.deepEqual(giftFarmSenders(group().map(s=>({...s,salaryEarned:0})),now),[]);
 assert.deepEqual(giftFarmSenders(group().map(s=>({...s,giftedAt:now+1})),now),[],'Future events are excluded');
 assert.equal(giftFarmSenders(group().map(s=>({...s,salaryEarned:1000,salarySentToRecipient:800})),now).length,5);
});
test('Creation, gift-window and age boundaries are inclusive; unrelated donors stay outside the matched group',()=>{
 const signals=group();signals[4].profileCreatedAt=signals[0].profileCreatedAt+120_000;
 assert.equal(giftFarmSenders(signals,now).length,5);
 signals[4].profileCreatedAt++;
 assert.deepEqual(giftFarmSenders(signals,now),[]);
 const exact=group().map(s=>({...s,giftedAt:now-120_000,profileCreatedAt:now-120_000-1_800_000}));
 assert.equal(giftFarmSenders(exact,now).length,5);
 assert.deepEqual(giftFarmSenders(exact,now+1),[]);
 const legitimate=[{...group(1)[0],senderId:'tel',profileCreatedAt:now-86_400_000},{...group(1)[0],senderId:'telle',profileCreatedAt:now-100_000}];
 assert.deepEqual(giftFarmSenders([...group(),...legitimate],now),group().map(s=>s.senderId));
});
test('Notice labels use the activity date in Britain, including date ranges and midnight boundaries',()=>{
 assert.equal(creditActivityDates(Date.parse('2026-09-11T14:34:09Z'),Date.parse('2026-09-11T14:34:57Z')),'11 September 2026');
 assert.equal(creditActivityDates(Date.parse('2026-09-12T13:42:08Z'),Date.parse('2026-09-12T14:42:26Z')),'12 September 2026');
 assert.equal(creditActivityDates(Date.parse('2026-09-11T22:59:00Z'),Date.parse('2026-09-11T23:01:00Z')),'11 September 2026 – 12 September 2026');
});
