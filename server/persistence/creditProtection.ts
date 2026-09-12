import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { STARTING_CREDITS } from '../../shared/catalog.ts';
import { GIFT_FARM_RULE, giftFarmSenders, type CreditNotice, type CreditNoticeAcknowledgement } from '../../shared/creditProtection.ts';
import { EconomyError, type EconomyRepository } from './economy.ts';
import { validProfileId } from './guests.ts';

export const GIFT_ENFORCEMENT_LOCK = 782641094;
export interface ConfirmedGiftIncident {
 key: string;
 profileId: string;
 detectedAt: string;
 expectedCredits: number;
 gifts: { senderId: string; requestId: string }[];
}
type RecordedGift = { sender_id: string; request_id: string; target_id: string; amount: number; created_at: Date };

export class CreditProtectionRepository {
 constructor(readonly economy: EconomyRepository) {}
 async initialise() {
  await this.economy.transaction(async c => {
   await c.query('SELECT pg_advisory_xact_lock(782641092)');
   const versions = (await c.query('SELECT version FROM guest_schema_migrations')).rows.map(r => r.version);
   if (!versions.includes(6) || versions.some(v => ![1,2,3,4,5,6,7,8,9,10,11,12,13].includes(v))) throw new Error('Unsupported credit protection schema');
   if (!versions.includes(13)) {
    await c.query(await readFile(new URL('./migrations/013_credit_protection.sql', import.meta.url), 'utf8'));
    await c.query('INSERT INTO guest_schema_migrations(version) VALUES(13)');
   }
  });
 }
 async restricted(c: PoolClient, profileId: string) {
  return !!(await c.query('SELECT 1 FROM gift_restrictions WHERE profile_id=$1', [profileId])).rowCount;
 }
 async reversed(c: PoolClient, senderId: string, requestId: string) {
  return !!(await c.query('SELECT 1 FROM credit_recoveries WHERE sender_id=$1 AND request_id=$2', [senderId,requestId])).rowCount;
 }
 /** Called inside the gift transaction, after its valid paired entries are written. */
 async detect(c: PoolClient, profileId: string, giftedAt: string) {
  // Preserve PostgreSQL microseconds for the inclusive SQL window. JS Date truncates them.
  const detectedAt=new Date(giftedAt);
  const rows = (await c.query(`
   SELECT g.sender_id,g.created_at,p.created_at AS joined_at,
    (SELECT coalesce(sum(l.amount),0) FROM economy_ledger l WHERE l.profile_id=g.sender_id AND l.kind='salary' AND l.created_at<=g.created_at) AS salary,
    (SELECT coalesce(sum(h.amount),0) FROM player_gifts h WHERE h.sender_id=g.sender_id AND h.target_id=g.target_id AND h.created_at<=g.created_at) AS sent,
    EXISTS(SELECT 1 FROM economy_ledger l WHERE l.profile_id=g.sender_id AND l.created_at<=g.created_at AND l.kind NOT IN ('grant','salary','gift_sent')) AS other_activity
   FROM player_gifts g JOIN guest_profiles p ON p.id=g.sender_id
   WHERE g.target_id=$1 AND g.created_at BETWEEN $2::timestamptz-interval '2 minutes' AND $2
    AND g.created_at<=p.created_at+interval '30 minutes'
   ORDER BY g.created_at LIMIT 8193`, [profileId,giftedAt])).rows;
  if (rows.length>8192) throw new EconomyError('gift_unavailable','Gifting is temporarily unavailable. Please try again shortly.',503);
  const senders = giftFarmSenders(rows.map(r => ({senderId:r.sender_id,profileCreatedAt:+r.joined_at,giftedAt:+r.created_at,salaryEarned:Number(r.salary),salarySentToRecipient:Number(r.sent),hasOtherActivity:r.other_activity})), +detectedAt);
  if (!senders.length) return;
  const gifts = (await c.query<RecordedGift>(`SELECT g.* FROM player_gifts g
   WHERE g.target_id=$1 AND g.sender_id=ANY($2::uuid[])
   AND NOT EXISTS(SELECT 1 FROM credit_recoveries r WHERE r.sender_id=g.sender_id AND r.request_id=g.request_id)
   ORDER BY g.created_at,g.sender_id,g.request_id`, [profileId,senders])).rows;
  if (gifts.length) {
   const day = detectedAt.toISOString().slice(0,10);
   await this.recoverLocked(c,`${GIFT_FARM_RULE.version}:${profileId}:${day}`,profileId,GIFT_FARM_RULE.version,detectedAt,gifts);
  }
 }
 private async recoverLocked(c: PoolClient, key: string, profileId: string, rule: string, detectedAt: Date, gifts: RecordedGift[]) {
  const first = gifts.reduce((a,g) => +g.created_at<+a?g.created_at:a,gifts[0].created_at);
  const last = gifts.reduce((a,g) => +g.created_at>+a?g.created_at:a,gifts[0].created_at);
  const incident = (await c.query(`INSERT INTO credit_incidents(id,incident_key,profile_id,rule,detected_at,activity_started_at,activity_ended_at)
   VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(incident_key) DO UPDATE SET
    activity_started_at=LEAST(credit_incidents.activity_started_at,EXCLUDED.activity_started_at),
    activity_ended_at=GREATEST(credit_incidents.activity_ended_at,EXCLUDED.activity_ended_at),
    revision=credit_incidents.revision+1,acknowledged_at=NULL
   WHERE credit_incidents.profile_id=EXCLUDED.profile_id AND credit_incidents.rule=EXCLUDED.rule
   RETURNING id,revision`, [randomUUID(),key,profileId,rule,detectedAt,first,last])).rows[0];
  if (!incident) throw new EconomyError('incident_conflict','This incident key belongs to a different correction.',409);
  for (const gift of gifts) {
   await c.query(`INSERT INTO credit_recoveries(sender_id,request_id,incident_id,profile_id,amount)
    VALUES($1,$2,$3,$4,$5)`, [gift.sender_id,gift.request_id,incident.id,profileId,gift.amount]);
   await c.query('INSERT INTO gift_restrictions(profile_id,incident_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[gift.sender_id,incident.id]);
   await c.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,$2,'gift_recovery',$3)",[profileId,`gift-recovery:${gift.sender_id}:${gift.request_id}`,-gift.amount]);
  }
  // Both callers hold this wallet's row lock. A reset settles this correction in full;
  // it creates no debt, salary allowance or future-income interception.
  const balance=(await c.query('SELECT balance FROM economy_wallets WHERE profile_id=$1',[profileId])).rows[0].balance;
  const after=balance-gifts.reduce((sum,g)=>sum+g.amount,0);
  if(after<0){
   await c.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,$2,'gift_reset',$3)",[profileId,`gift-reset:${incident.id}:${incident.revision}`,STARTING_CREDITS-after]);
   await c.query('UPDATE credit_incidents SET balance_reset_to=$2 WHERE id=$1',[incident.id,STARTING_CREDITS]);
  }
  await c.query('UPDATE economy_wallets SET balance=$2,revision=revision+1 WHERE profile_id=$1',[profileId,after<0?STARTING_CREDITS:after]);
 }
 async pending(profileId: string): Promise<CreditNotice[]> {
  const rows = (await this.economy.pool.query(`SELECT i.id,i.revision,i.activity_started_at,i.activity_ended_at,i.balance_reset_to,
   sum(r.amount) AS credits
   FROM credit_incidents i JOIN credit_recoveries r ON r.incident_id=i.id
   WHERE i.profile_id=$1 AND i.acknowledged_at IS NULL
   GROUP BY i.id ORDER BY i.created_at,i.id`, [profileId])).rows;
  return rows.map(r => ({id:r.id,revision:r.revision,activityStartedAt:+r.activity_started_at,activityEndedAt:+r.activity_ended_at,credits:Number(r.credits),balanceResetTo:r.balance_reset_to}));
 }
 async acknowledge(profileId: string, notices: unknown) {
  if (!Array.isArray(notices) || !notices.length || notices.length>20 || notices.some(n => !n || !validProfileId(n.id) || !Number.isSafeInteger(n.revision) || n.revision<1) || new Set(notices.map(n => n.id)).size!==notices.length) throw new EconomyError('invalid_notice','Choose the notices to acknowledge.',400);
  const requested = notices as CreditNoticeAcknowledgement[];
  await this.economy.transaction(async c => {
   const rows = (await c.query('SELECT id,revision FROM credit_incidents WHERE profile_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[profileId,requested.map(n => n.id)])).rows;
   if (rows.length!==requested.length) throw new EconomyError('notice_not_found','Notice not found.',404);
   if (rows.some(r => requested.find(n => n.id===r.id)!.revision!==r.revision)) throw new EconomyError('notice_changed','This notice has been updated. Please read the latest details.',409);
   await c.query('UPDATE credit_incidents SET acknowledged_at=coalesce(acknowledged_at,now()) WHERE profile_id=$1 AND id=ANY($2::uuid[])',[profileId,requested.map(n => n.id)]);
  });
 }
 /** Explicit, exact-gift incident import. Dry-run is the default; no schema or grant creation. */
 async confirmed(input: ConfirmedGiftIncident, apply = false) {
  if (!input || typeof input.key!=='string' || !/^[a-zA-Z0-9:_-]{8,160}$/.test(input.key) || !validProfileId(input.profileId)
   || !Number.isFinite(Date.parse(input.detectedAt)) || !Number.isSafeInteger(input.expectedCredits) || input.expectedCredits<1
   || !Array.isArray(input.gifts) || !input.gifts.length || input.gifts.length>1000
   || input.gifts.some(g => !validProfileId(g.senderId) || !validProfileId(g.requestId))
   || new Set(input.gifts.map(g => `${g.senderId}:${g.requestId}`)).size!==input.gifts.length) throw new EconomyError('invalid_incident','Invalid confirmed incident.',400);
  return this.economy.transaction(async c => {
   if (!apply) await c.query('SET TRANSACTION READ ONLY');
   if (apply) {
    await c.query('SELECT pg_advisory_xact_lock($1)',[GIFT_ENFORCEMENT_LOCK]);
    if (!(await c.query('SELECT profile_id FROM economy_wallets WHERE profile_id=$1 FOR UPDATE',[input.profileId])).rowCount) throw new EconomyError('invalid_incident','Recipient wallet not found.',404);
   }
   const rows = (await c.query<RecordedGift>(`SELECT g.* FROM player_gifts g
    JOIN jsonb_to_recordset($1::jsonb) AS wanted("senderId" uuid,"requestId" uuid)
    ON g.sender_id=wanted."senderId" AND g.request_id=wanted."requestId"
    WHERE g.target_id=$2 ORDER BY g.created_at,g.sender_id,g.request_id`,[JSON.stringify(input.gifts),input.profileId])).rows;
   if (rows.length!==input.gifts.length || rows.reduce((sum,g) => sum+g.amount,0)!==input.expectedCredits) throw new EconomyError('incident_mismatch','Recorded gifts do not match the confirmed recipient and total.',409);
   const recovered = (await c.query('SELECT sender_id,request_id FROM credit_recoveries WHERE profile_id=$1',[input.profileId])).rows;
   const done = new Set(recovered.map(r => `${r.sender_id}:${r.request_id}`));
   const remaining = rows.filter(g => !done.has(`${g.sender_id}:${g.request_id}`));
   if (apply && remaining.length) await this.recoverLocked(c,input.key,input.profileId,'confirmed-salary-farm',new Date(input.detectedAt),remaining);
   return {profileId:input.profileId,credits:input.expectedCredits,gifts:rows.length,newCredits:remaining.reduce((sum,g) => sum+g.amount,0),applied:apply,activityStartedAt:rows[0].created_at.toISOString(),activityEndedAt:rows.at(-1)!.created_at.toISOString()};
  });
 }
}
