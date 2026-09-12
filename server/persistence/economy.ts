import { CREDIT_LEADERBOARD_LIMIT, type CreditLeaderboard } from '../../shared/creditLeaderboard.ts';
import { readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';
import { clothingItem, STARTER_OUTFIT, STARTING_CREDITS, SALARY_CREDITS, SALARY_INTERVAL_MS, type WalletState, type Outfit } from '../../shared/catalog.ts';
export class EconomyError extends Error {
 constructor(public code: string, message: string, public status = 409, public snapshot?: WalletState) { super(message); }
}
export class EconomyRepository {
 constructor(readonly pool: Pool) {}
 async creditLeaderboard(): Promise<CreditLeaderboard> {
  // One SQL snapshot sees wallet debits and poker escrow transfers atomically.
  // During an active hand, durable escrow retains its opening stack until settlement.
  const result = await this.pool.query(`
   WITH fortunes AS (
    SELECT g.id, g.name, g.created_at, w.balance::bigint + coalesce(p.stack, 0) AS credits
    FROM economy_wallets w JOIN guest_profiles g ON g.id=w.profile_id
    LEFT JOIN poker_seats p ON p.profile_id=w.profile_id AND p.status='open'
   )
   SELECT name, credits, rank() OVER (ORDER BY credits DESC) AS rank
   FROM fortunes ORDER BY credits DESC, created_at ASC, id ASC LIMIT $1
  `, [CREDIT_LEADERBOARD_LIMIT]);
  return { updatedAt: Date.now(), entries: result.rows.map(row => ({ rank: Number(row.rank), name: row.name, credits: Number(row.credits) })) };
 }

 async transaction<T>(work:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client=await this.pool.connect();
  try { await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='3s'");const result=await work(client);await client.query('COMMIT');return result; }
  catch(error){try{await client.query('ROLLBACK');}catch{/* Preserve initial failure. */}throw error;}finally{client.release();}
 }
 async initialise() {
  await this.transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(782641092)');
   const versions=await c.query('SELECT version FROM guest_schema_migrations');
   if(!versions.rows.some(r=>r.version===1)||versions.rows.some(r=>r.version!==1&&r.version!==2&&r.version!==3&&r.version!==4&&r.version!==5&&r.version!==6&&r.version!==7&&r.version!==8&&r.version!==9&&r.version!==10&&r.version!==11&&r.version!==12&&r.version!==13))throw new Error('Unsupported economy schema');
   if(!versions.rows.some(r=>r.version===2)) {await c.query(await readFile(new URL('./migrations/002_economy.sql',import.meta.url),'utf8'));await c.query('INSERT INTO guest_schema_migrations(version) VALUES(2)');}
   await c.query('SELECT balance,revision,salary_remainder,salary_sequence,session_epoch,session_checkpoint FROM economy_wallets LIMIT 0');
  });
 }
 async lock(c:PoolClient,id:string) {
  const inserted=await c.query('INSERT INTO economy_wallets(profile_id,balance) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING profile_id',[id,STARTING_CREDITS]);
  await c.query('SELECT profile_id FROM economy_wallets WHERE profile_id=$1 FOR UPDATE',[id]);
  if(inserted.rowCount){
   await c.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,'grant','grant',$2)",[id,STARTING_CREDITS]);
   for(const [slot,item] of Object.entries(STARTER_OUTFIT)) {
    await c.query('INSERT INTO economy_owned(profile_id,item_id,slot) VALUES($1,$2,$3)',[id,item,slot]);
    await c.query('INSERT INTO economy_equipment(profile_id,slot,item_id) VALUES($1,$2,$3)',[id,slot,item]);
   }
  }
 }
 async snapshot(c:PoolClient,id:string):Promise<WalletState> {
  const w=(await c.query('SELECT balance,revision,salary_remainder FROM economy_wallets WHERE profile_id=$1',[id])).rows[0];
  const owned=(await c.query('SELECT item_id FROM economy_owned WHERE profile_id=$1 ORDER BY item_id',[id])).rows.map(r=>r.item_id);
  const outfit=Object.fromEntries((await c.query('SELECT slot,item_id FROM economy_equipment WHERE profile_id=$1',[id])).rows.map(r=>[r.slot,r.item_id])) as Outfit;
  return {balance:w.balance,revision:w.revision,salaryProgressMs:w.salary_remainder,owned,outfit};
 }
 ensure(id:string){return this.transaction(async c=>{await this.lock(c,id);return this.snapshot(c,id);});}
 openSession(id:string,epoch:string){return this.transaction(async c=>{
  await this.lock(c,id);await c.query('UPDATE economy_wallets SET session_epoch=$2,session_checkpoint=0 WHERE profile_id=$1 AND session_epoch IS DISTINCT FROM $2::uuid',[id,epoch]);return this.snapshot(c,id);
 });}
 checkpoint(id:string,epoch:string,cumulativeEligibleMs:number){
  if(!Number.isSafeInteger(cumulativeEligibleMs)||cumulativeEligibleMs<0)throw new EconomyError('invalid_time','Invalid salary checkpoint',400);
  return this.transaction(async c=>{
   await this.lock(c,id);const w=(await c.query('SELECT session_epoch,session_checkpoint,salary_remainder,salary_sequence FROM economy_wallets WHERE profile_id=$1',[id])).rows[0];
   if(w.session_epoch!==epoch)throw new EconomyError('stale_session','This salary session has ended');
   const delta=Math.max(0,cumulativeEligibleMs-Number(w.session_checkpoint));
   if(delta){
    const total=w.salary_remainder+delta,payments=Math.floor(total/SALARY_INTERVAL_MS);
    for(let i=1;i<=payments;i++)await c.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,$2,'salary',$3)",[id,`salary:${w.salary_sequence+i}`,SALARY_CREDITS]);
    await c.query('UPDATE economy_wallets SET balance=balance+$2,salary_remainder=$3,salary_sequence=salary_sequence+$4,session_checkpoint=$5,revision=revision+1 WHERE profile_id=$1',[id,payments*SALARY_CREDITS,total%SALARY_INTERVAL_MS,payments,cumulativeEligibleMs]);
   }
   return this.snapshot(c,id);
  });
 }
 purchase(id:string,itemId:string,requestId:string,canPurchase:()=>boolean=()=>true){
  const item=clothingItem(itemId);if(!item)throw new EconomyError('invalid_item','Unknown clothing item',400);
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))throw new EconomyError('invalid_request','Invalid purchase request ID',400);
  return this.transaction(async c=>{
   await this.lock(c,id);const snapshot=await this.snapshot(c,id);
   const prior=(await c.query('SELECT item_id FROM economy_ledger WHERE profile_id=$1 AND operation_key=$2',[id,`purchase:${requestId}`])).rows[0];
   if(prior){if(prior.item_id!==itemId)throw new EconomyError('request_conflict','This request was used for another item',409,snapshot);return snapshot;}
   if(!canPurchase())throw new EconomyError('outside_shop','Visit Form & Thread to buy clothing',409,snapshot);
   const price=snapshot.owned.includes(itemId)?0:item.price;
   if(snapshot.balance<price)throw new EconomyError('insufficient_funds','You need more credits for this item',409,snapshot);
   await c.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount,item_id) VALUES($1,$2,'purchase',$3,$4)",[id,`purchase:${requestId}`,-price,itemId]);
   await c.query('INSERT INTO economy_owned(profile_id,item_id,slot) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,itemId,item.slot]);
   await c.query('UPDATE economy_wallets SET balance=balance-$2,revision=revision+1 WHERE profile_id=$1',[id,price]);return this.snapshot(c,id);
  });
 }
 equip(id:string,itemId:string,expectedRevision:number){
  const item=clothingItem(itemId);if(!item)throw new EconomyError('invalid_item','Unknown clothing item',400);
  return this.transaction(async c=>{
   await this.lock(c,id);const snapshot=await this.snapshot(c,id);
   if(snapshot.revision!==expectedRevision)throw new EconomyError('stale_revision','Your wardrobe changed. Please try again.',409,snapshot);
   if(!snapshot.owned.includes(itemId))throw new EconomyError('not_owned','Buy this item before equipping it',409,snapshot);
   await c.query('UPDATE economy_equipment SET item_id=$3 WHERE profile_id=$1 AND slot=$2',[id,item.slot,itemId]);
   await c.query('UPDATE economy_wallets SET revision=revision+1 WHERE profile_id=$1',[id]);return this.snapshot(c,id);
  });
 }
}
