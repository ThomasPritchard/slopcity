import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { EconomyError, type EconomyRepository } from './economy.ts';
import { validProfileId } from './guests.ts';
import { MAX_GIFT_CREDITS, type FriendAction, type GiftReceipt, type SocialSnapshot } from '../../shared/playerSocial.ts';
export class SocialRepository {
 constructor(readonly economy:EconomyRepository) {}
 async initialise(){await this.economy.transaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(782641092)');
  const versions=(await c.query('SELECT version FROM guest_schema_migrations')).rows.map(r=>r.version);
  if(!versions.includes(5)||versions.some(v=>![1,2,3,4,5,6,7,8,9].includes(v)))throw new Error('Unsupported social schema');
  if(!versions.includes(6)){await c.query(await readFile(new URL('./migrations/006_player_social.sql',import.meta.url),'utf8'));await c.query('INSERT INTO guest_schema_migrations(version) VALUES(6)');}
 });}
 private validate(id:string,target:string){if(!validProfileId(target)||id===target)throw new EconomyError('invalid_target','Choose another player',400);}
 private async pair(c:PoolClient,id:string,target:string){
  const rows=await c.query('SELECT id FROM guest_profiles WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[id,target]]);
  if(rows.rowCount!==2)throw new EconomyError('invalid_target','Player not found',404);
 }
 private async unblocked(c:PoolClient,id:string,target:string){if((await c.query('SELECT 1 FROM guest_blocks WHERE (owner_id=$1 AND target_id=$2) OR (owner_id=$2 AND target_id=$1)',[id,target])).rowCount)throw new EconomyError('blocked','This interaction is unavailable',409);}
 private async allowance(c:PoolClient,id:string):Promise<number>{return (await c.query('SELECT gifting_allowance FROM economy_wallets WHERE profile_id=$1',[id])).rows[0].gifting_allowance;}
 async snapshot(id:string,online:(id:string)=>boolean=()=>false):Promise<SocialSnapshot>{return this.economy.transaction(async c=>{
  await this.economy.lock(c,id);
  const rows=(await c.query(`SELECT p.id,p.name,f.requester_id,f.accepted FROM player_friendships f JOIN guest_profiles p ON p.id=CASE WHEN f.low_id=$1 THEN f.high_id ELSE f.low_id END WHERE (f.low_id=$1 OR f.high_id=$1) AND NOT EXISTS(SELECT 1 FROM guest_blocks b WHERE (b.owner_id=$1 AND b.target_id=p.id) OR (b.owner_id=p.id AND b.target_id=$1)) ORDER BY p.name,p.id`,[id])).rows;
  const result:SocialSnapshot={friends:[],incoming:[],outgoing:[],giftingAllowance:await this.allowance(c,id)};
  for(const row of rows)result[row.accepted?'friends':row.requester_id===id?'outgoing':'incoming'].push({profileId:row.id,name:row.name,online:online(row.id)});
  return result;
 });}
 async friend(id:string,target:string,action:FriendAction){
  this.validate(id,target);
  if(!['request','accept','decline','cancel','remove'].includes(action))throw new EconomyError('invalid_action','Choose a friend action',400);
  await this.economy.transaction(async c=>{
   await this.pair(c,id,target);await this.unblocked(c,id,target);
   const [low,high]=[id,target].sort();const row=(await c.query('SELECT requester_id,accepted FROM player_friendships WHERE low_id=$1 AND high_id=$2',[low,high])).rows[0];
   if(action==='request'){
    if(row){if(row.accepted||row.requester_id===id)return;throw new EconomyError('incoming_request','Accept or decline the incoming request');}
    await c.query('INSERT INTO player_friendships(low_id,high_id,requester_id) VALUES($1,$2,$3)',[low,high,id]);return;
   }
   if(!row)return;
   if(action==='accept'&&!row.accepted&&row.requester_id===target){await c.query('UPDATE player_friendships SET accepted=true WHERE low_id=$1 AND high_id=$2',[low,high]);return;}
   if(action==='accept'&&row.accepted)return;
   if((action==='remove'&&row.accepted)||(action==='cancel'&&!row.accepted&&row.requester_id===id)||(action==='decline'&&!row.accepted&&row.requester_id===target)){await c.query('DELETE FROM player_friendships WHERE low_id=$1 AND high_id=$2',[low,high]);return;}
   throw new EconomyError('invalid_action','That friend request has changed');
  });
 }
 async gift(id:string,target:string,amount:number,requestId:string,eligible:()=>boolean):Promise<GiftReceipt>{
  this.validate(id,target);
  if(!validProfileId(requestId)||!Number.isSafeInteger(amount)||amount<1||amount>MAX_GIFT_CREDITS)throw new EconomyError('invalid_gift','Enter a whole credit amount from 1 to 1000 and a request UUID',400);
  return this.economy.transaction(async c=>{
   await this.pair(c,id,target);
   for(const profile of [id,target].sort())await this.economy.lock(c,profile);
   const prior=(await c.query('SELECT target_id,amount FROM player_gifts WHERE sender_id=$1 AND request_id=$2',[id,requestId])).rows[0];
   if(prior){if(prior.target_id!==target||prior.amount!==amount)throw new EconomyError('request_conflict','This gift request was used for another gift');return {requestId,targetId:target,amount,wallet:await this.economy.snapshot(c,id),giftingAllowance:await this.allowance(c,id),replayed:true};}
   await this.unblocked(c,id,target);
   const wallet=await this.economy.snapshot(c,id),allowance=await this.allowance(c,id);
   if(wallet.balance<amount)throw new EconomyError('insufficient_funds','You need more credits');
   if(allowance<amount)throw new EconomyError('insufficient_allowance','Earn more salary before gifting these credits');
   if(!eligible())throw new EconomyError('not_nearby','Both players must be nearby in the same town');
   await c.query('INSERT INTO player_gifts(sender_id,request_id,target_id,amount) VALUES($1,$2,$3,$4)',[id,requestId,target,amount]);
   await c.query('UPDATE economy_wallets SET balance=balance-$2,gifting_allowance=gifting_allowance-$2,revision=revision+1 WHERE profile_id=$1',[id,amount]);
   await c.query('UPDATE economy_wallets SET balance=balance+$2,revision=revision+1 WHERE profile_id=$1',[target,amount]);
   await c.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,$3,'gift_sent',-$4::integer),($2,$3,'gift_received',$4)",[id,target,`gift:${id}:${requestId}`,amount]);
   return {requestId,targetId:target,amount,wallet:await this.economy.snapshot(c,id),giftingAllowance:await this.allowance(c,id),replayed:false};
  });
 }
}
