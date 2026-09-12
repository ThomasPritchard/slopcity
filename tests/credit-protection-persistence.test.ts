import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { GuestRepository } from '../server/persistence/guests.ts';
import { EconomyError,EconomyRepository } from '../server/persistence/economy.ts';
import { CasinoRepository } from '../server/persistence/casino.ts';
import { SocialRepository } from '../server/persistence/social.ts';
import { CreditProtectionRepository,type ConfirmedGiftIncident } from '../server/persistence/creditProtection.ts';
import { PokerRepository } from '../server/persistence/poker.ts';
import { SALARY_INTERVAL_MS,STARTING_CREDITS } from '../shared/catalog.ts';

const rejects=(code:string)=>(e:unknown)=>e instanceof EconomyError&&e.code===code;
async function fixture(work:(f:Awaited<ReturnType<typeof setup>>)=>Promise<void>){
 const f=await setup();
 try{await work(f);}finally{await f.guests.close();await f.root.query(`DROP SCHEMA ${f.schema} CASCADE`);await f.root.end();}
}
async function setup(){
 const source=new URL(process.env.DATABASE_URL!);
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(source.hostname),'Use only the local development database');
 const root=new Pool({connectionString:source.toString()});const schema=`credit_protection_${randomUUID().replaceAll('-','')}`;
 await root.query(`CREATE SCHEMA ${schema}`);source.searchParams.set('options',`-c search_path=${schema}`);
 const guests=new GuestRepository(source.toString()),economy=new EconomyRepository(guests.pool),casino=new CasinoRepository(economy),social=new SocialRepository(economy),protection=social.protection;
 await guests.initialise();await economy.initialise();await casino.initialise();await social.initialise();
 const person=async(name:string,payments=0)=>{const g=await guests.create({name,shirt:0,skin:0});await economy.ensure(g.profile.id);const epoch=randomUUID();await economy.openSession(g.profile.id,epoch);if(payments)await economy.checkpoint(g.profile.id,epoch,payments*SALARY_INTERVAL_MS);return {...g,id:g.profile.id,epoch};};
 const balanced=async()=>{const r=await guests.pool.query('SELECT w.profile_id FROM economy_wallets w JOIN economy_ledger l USING(profile_id) GROUP BY w.profile_id HAVING w.balance<>sum(l.amount)');assert.equal(r.rowCount,0);};
 return{root,schema,guests,economy,casino,social,protection,person,balanced,source:source.toString()};
}
test('Five concurrent salary donors trigger one recovery; legitimate generosity, retries, restarts and renames are safe',{skip:!process.env.DATABASE_URL},()=>fixture(async f=>{
 const target=await f.person('Recipient'),legit=await f.person('Legitimate',10);
 await f.guests.pool.query("UPDATE guest_profiles SET created_at=now()-interval '1 day' WHERE id=$1",[legit.id]);
 const legitRequest=randomUUID();await f.social.gift(legit.id,target.id,1000,legitRequest,()=>true);
 assert.equal((await f.economy.ensure(target.id)).balance,2000);assert.deepEqual(await f.protection.pending(target.id),[]);
 const donors=await Promise.all(Array.from({length:5},(_,i)=>f.person(`Donor ${i}`,1)));
 const requests=donors.map(()=>randomUUID());
 const receipts=await Promise.all(donors.map((d,i)=>f.social.gift(d.id,target.id,100,requests[i],()=>true)));
 assert.equal(receipts.filter(r=>r.reversed).length,1,'Triggering gift is marked reversed; earlier responses remain historical receipts');
 assert.equal((await f.economy.ensure(target.id)).balance,2000,'Recover exactly five gifts, preserve the legitimate 100% salary gift');
 let notices=await f.protection.pending(target.id);assert.equal(notices.length,1);assert.equal(notices[0].credits,500);assert.equal(notices[0].balanceResetTo,null);
 for(let i=0;i<5;i++){
  assert.equal((await f.social.gift(donors[i].id,target.id,100,requests[i],()=>false)).reversed,true);
  await f.guests.pool.query('UPDATE guest_profiles SET name=$2 WHERE id=$1',[donors[i].id,`Renamed ${i}`]);
  await assert.rejects(f.social.gift(donors[i].id,target.id,1,randomUUID(),()=>true),rejects('gift_restricted'));
 }
 await f.guests.initialise();await f.economy.initialise();await f.casino.initialise();await f.social.initialise();
 const restarted=new CreditProtectionRepository(f.economy);assert.equal((await restarted.pending(target.id))[0].credits,500);
 await assert.rejects(restarted.acknowledge(legit.id,notices),rejects('notice_not_found'));
 await restarted.acknowledge(target.id,notices);await restarted.acknowledge(target.id,notices);
 assert.deepEqual(await restarted.pending(target.id),[]);await f.balanced();
 // A sixth member produces new evidence in the same incident, without charging the original five again.
 const sixth=await f.person('Sixth donor',1);await f.social.gift(sixth.id,target.id,100,randomUUID(),()=>true);
 await assert.rejects(restarted.acknowledge(target.id,notices),rejects('notice_changed'));
 notices=await restarted.pending(target.id);assert.equal(notices[0].credits,600);assert.equal(notices[0].balanceResetTo,null);
 assert.equal((await f.economy.ensure(target.id)).balance,2000);await f.balanced();
}));

test('Confirmed historical gifts recover once, retain original activity dates and leave protected gifts untouched',{skip:!process.env.DATABASE_URL},()=>fixture(async f=>{
 const target=await f.person('Historical target'),sender=await f.person('Known source',2),legit=await f.person('Protected friend',2);
 const request=randomUUID(),legitRequest=randomUUID();await f.social.gift(sender.id,target.id,200,request,()=>true);await f.social.gift(legit.id,target.id,200,legitRequest,()=>true);
 await f.guests.pool.query("UPDATE player_gifts SET created_at='2026-09-11T14:34:09Z' WHERE sender_id=$1 AND request_id=$2",[sender.id,request]);
 const input:ConfirmedGiftIncident={key:'confirmed:historical',profileId:target.id,detectedAt:'2026-09-12T16:33:09Z',expectedCredits:200,gifts:[{senderId:sender.id,requestId:request}]};
 assert.equal((await f.protection.confirmed(input)).applied,false);assert.deepEqual(await f.protection.pending(target.id),[]);assert.equal((await f.economy.ensure(target.id)).balance,1400);
 await assert.rejects(f.protection.confirmed({...input,expectedCredits:201},true),rejects('incident_mismatch'));
 const results=await Promise.all([f.protection.confirmed(input,true),f.protection.confirmed(input,true)]);
 assert.equal(results.reduce((sum,r)=>sum+r.newCredits,0),200);assert.equal((await f.economy.ensure(target.id)).balance,1200);
 const notice=(await f.protection.pending(target.id))[0];assert.equal(notice.activityStartedAt,Date.parse('2026-09-11T14:34:09Z'));
 await f.protection.acknowledge(target.id,[notice]);await f.protection.confirmed(input,true);assert.deepEqual(await f.protection.pending(target.id),[]);await f.balanced();
}));

test('An insufficient wallet resets to starting credits once, with no debt against salary or poker cash-outs',{skip:!process.env.DATABASE_URL},()=>fixture(async f=>{
 const target=await f.person('Escrow recipient'),sender=await f.person('Escrow source',10);
 const request=randomUUID();await f.social.gift(sender.id,target.id,1000,request,()=>true);
 const poker=new PokerRepository(f.economy);
 const seat=await poker.buyIn({profileId:target.id,requestId:randomUUID(),fingerprint:'reset-buyin',roomId:'reset-town',tableId:'poker-1',seat:0,amount:1000},()=>{});
 // Spend another 900 at actual catalogue prices, leaving 100 in the wallet.
 await f.economy.purchase(target.id,'oxblood-boots','reset-boots');await f.economy.purchase(target.id,'rust-bomber','reset-jacket');
 const input:ConfirmedGiftIncident={key:'confirmed:escrow-case',profileId:target.id,detectedAt:new Date().toISOString(),expectedCredits:1000,gifts:[{senderId:sender.id,requestId:request}]};
 const allowance=(await f.social.snapshot(target.id)).giftingAllowance;
 await Promise.all([f.protection.confirmed(input,true),f.protection.confirmed(input,true)]);
 assert.equal((await f.economy.ensure(target.id)).balance,STARTING_CREDITS);
 const notice=(await f.protection.pending(target.id))[0];assert.equal(notice.balanceResetTo,STARTING_CREDITS);assert.equal(notice.credits,1000);
 assert.equal((await f.social.snapshot(target.id)).giftingAllowance,allowance,'Reset credits do not create salary gifting allowance');
 await f.economy.checkpoint(target.id,target.epoch,SALARY_INTERVAL_MS);assert.equal((await f.economy.ensure(target.id)).balance,1100);
 assert.equal((await poker.cashOut(seat.escrow.id)).wallet.balance,2100);
 assert.equal((await poker.cashOut(seat.escrow.id)).wallet.balance,2100,'Cash-out replay cannot add credits twice');
 await f.protection.acknowledge(target.id,[notice]);await f.protection.confirmed(input,true);
 assert.equal((await f.economy.ensure(target.id)).balance,2100,'Incident replay cannot reset again or collect future income');
 assert.deepEqual(await f.protection.pending(target.id),[]);
 assert.equal((await f.guests.pool.query("SELECT 1 FROM economy_ledger WHERE profile_id=$1 AND kind='gift_reset'",[target.id])).rowCount,1);
 await f.balanced();
}));

test('A deduction landing exactly at zero is not reset; one credit below zero is reset atomically',{skip:!process.env.DATABASE_URL},()=>fixture(async f=>{
 for(const [spend,expected]of[[1000,0],[1001,STARTING_CREDITS]]){
  const target=await f.person(`Boundary ${spend}`),sender=await f.person(`Boundary source ${spend}`,10);
  const request=randomUUID();await f.social.gift(sender.id,target.id,1000,request,()=>true);
  await f.economy.transaction(async c=>{
   await f.economy.lock(c,target.id);
   await c.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,'fixture:spend','purchase',$2)",[target.id,-spend]);
   await c.query('UPDATE economy_wallets SET balance=balance-$2 WHERE profile_id=$1',[target.id,spend]);
  });
  const input:ConfirmedGiftIncident={key:`confirmed:boundary-${spend}`,profileId:target.id,detectedAt:new Date().toISOString(),expectedCredits:1000,gifts:[{senderId:sender.id,requestId:request}]};
  if(spend===1001){
   await f.guests.pool.query("ALTER TABLE economy_ledger ADD CONSTRAINT reject_reset CHECK(kind<>'gift_reset') NOT VALID");
   await assert.rejects(f.protection.confirmed(input,true));assert.equal((await f.economy.ensure(target.id)).balance,999);assert.deepEqual(await f.protection.pending(target.id),[]);
   await f.guests.pool.query('ALTER TABLE economy_ledger DROP CONSTRAINT reject_reset');
  }
  await f.protection.confirmed(input,true);assert.equal((await f.economy.ensure(target.id)).balance,expected);
  assert.equal((await f.protection.pending(target.id))[0].balanceResetTo,spend===1000?null:STARTING_CREDITS);
  await f.protection.confirmed(input,true);assert.equal((await f.economy.ensure(target.id)).balance,expected);await f.balanced();
 }
}));

test('Failed recovery rolls back the entire triggering gift, incident and restrictions',{skip:!process.env.DATABASE_URL},()=>fixture(async f=>{
 const target=await f.person('Rollback recipient'),donors=await Promise.all(Array.from({length:5},(_,i)=>f.person(`Rollback donor ${i}`,1)));
 for(const d of donors.slice(0,4))await f.social.gift(d.id,target.id,100,randomUUID(),()=>true);
 const request=randomUUID();await f.guests.pool.query("ALTER TABLE economy_ledger ADD CONSTRAINT reject_recovery CHECK(kind<>'gift_recovery') NOT VALID");
 await assert.rejects(f.social.gift(donors[4].id,target.id,100,request,()=>true));
 assert.equal((await f.economy.ensure(target.id)).balance,1400);assert.equal((await f.economy.ensure(donors[4].id)).balance,1100);
 assert.deepEqual(await f.protection.pending(target.id),[]);assert.equal((await f.guests.pool.query('SELECT * FROM gift_restrictions')).rowCount,0);
 await f.guests.pool.query('ALTER TABLE economy_ledger DROP CONSTRAINT reject_recovery');
 assert.equal((await f.social.gift(donors[4].id,target.id,100,request,()=>true)).reversed,true);assert.equal((await f.economy.ensure(target.id)).balance,1000);await f.balanced();
}));
