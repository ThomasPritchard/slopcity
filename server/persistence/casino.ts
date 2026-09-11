import { ROULETTE_MAX_ROUND_STAKE } from '../../shared/casino.ts';
import { PokerRepository } from './poker.ts';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { EconomyError, EconomyRepository } from './economy.ts';
import type { WalletState } from '../../shared/catalog.ts';

export type Wager = { id: string; profileId: string; requestId: string; fingerprint: string; roomId: string; tableId: string; roundId: string; stake: number; details: Record<string, unknown>; status: 'pending' | 'settled' | 'refunded'; returned: number | null };
export type WagerInput = Omit<Wager, 'id' | 'status' | 'returned'>;
export type WagerResult = { wager: Wager; wallet: WalletState; replayed: boolean };
function wager(row: Record<string, any>): Wager {
 return { id: row.id, profileId: row.profile_id, requestId: row.request_id, fingerprint: row.fingerprint, roomId: row.room_id, tableId: row.table_id, roundId: row.round_id, stake: row.stake, details: row.details, status: row.status, returned: row.returned };
}
export class CasinoRepository {
 readonly poker: PokerRepository;
 constructor(readonly economy: EconomyRepository) { this.poker = new PokerRepository(economy); }
 async initialise() {
  await this.economy.transaction(async c => {
   await c.query('SELECT pg_advisory_xact_lock(782641092)');
   const versions = (await c.query('SELECT version FROM guest_schema_migrations')).rows.map(r => r.version);
   if (!versions.includes(2) || versions.some(v => ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(v))) throw new Error('Unsupported casino schema');
   if (!versions.includes(3)) {
    await c.query(await readFile(new URL('./migrations/003_casino.sql', import.meta.url), 'utf8'));
    await c.query('INSERT INTO guest_schema_migrations(version) VALUES(3)');
   }
   if (!versions.includes(4)) {
    await c.query(await readFile(new URL('./migrations/004_craps.sql', import.meta.url), 'utf8'));
    await c.query('INSERT INTO guest_schema_migrations(version) VALUES(4)');
   }
   if (!versions.includes(5)) {
    await c.query(await readFile(new URL('./migrations/005_poker.sql', import.meta.url), 'utf8'));
    await c.query('INSERT INTO guest_schema_migrations(version) VALUES(5)');
   }
   if (!versions.includes(7)) {
    await c.query(await readFile(new URL('./migrations/007_roulette_stakes.sql', import.meta.url), 'utf8'));
    await c.query('INSERT INTO guest_schema_migrations(version) VALUES(7)');
   }
   await c.query('SELECT id,request_id,fingerprint,stake,status,returned FROM casino_wagers LIMIT 0');
  });
 }
 async replay(profileId: string, requestId: string, fingerprint: string): Promise<WagerResult | null> {
  return this.economy.transaction(async c => {
   await this.economy.lock(c, profileId);
   const row = (await c.query('SELECT * FROM casino_wagers WHERE profile_id=$1 AND request_id=$2', [profileId, requestId])).rows[0];
   if (!row) {
    if ((await c.query('SELECT 1 FROM poker_requests WHERE profile_id=$1 AND request_id=$2', [profileId, requestId])).rowCount) throw new EconomyError('request_conflict', 'This request was used for a poker buy-in');
    return null;
   }
   const wallet = await this.economy.snapshot(c, profileId);
   if (row.fingerprint !== fingerprint) throw new EconomyError('request_conflict', 'This request was used for another casino action', 409, wallet);
   return { wager: wager(row), wallet, replayed: true };
  });
 }
 async accept(input: WagerInput, validate: () => void): Promise<WagerResult> {
  const maxStake = input.details.game === 'roulette' ? ROULETTE_MAX_ROUND_STAKE : 100;
  if (!Number.isSafeInteger(input.stake) || input.stake < 10 || input.stake > maxStake || input.stake % 10) throw new EconomyError('invalid_stake', `Use 10–${maxStake} credits in steps of 10`, 400);
  return this.economy.transaction(async c => {
   await this.economy.lock(c, input.profileId);
   const wallet = await this.economy.snapshot(c, input.profileId);
   const prior = (await c.query('SELECT * FROM casino_wagers WHERE profile_id=$1 AND request_id=$2', [input.profileId, input.requestId])).rows[0];
   if (prior) {
    if (prior.fingerprint !== input.fingerprint) throw new EconomyError('request_conflict', 'This request was used for another casino action', 409, wallet);
    return { wager: wager(prior), wallet, replayed: true };
   }
   if ((await c.query('SELECT 1 FROM poker_requests WHERE profile_id=$1 AND request_id=$2', [input.profileId, input.requestId])).rowCount) throw new EconomyError('request_conflict', 'This request was used for a poker buy-in', 409, wallet);
   validate(); // Recheck live ownership, proximity, round and deadline after the shared wallet lock.
   if (wallet.balance < input.stake) throw new EconomyError('insufficient_funds', 'You need more credits for this wager', 409, wallet);
   const id = randomUUID();
   const row = (await c.query('INSERT INTO casino_wagers(id,profile_id,request_id,fingerprint,room_id,table_id,round_id,stake,details,game) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *', [id, input.profileId, input.requestId, input.fingerprint, input.roomId, input.tableId, input.roundId, input.stake, input.details, input.details.game])).rows[0];
   await c.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,$2,'casino_bet',$3)", [input.profileId, `casino:bet:${id}`, -input.stake]);
   await c.query('UPDATE economy_wallets SET balance=balance-$2,revision=revision+1 WHERE profile_id=$1', [input.profileId, input.stake]);
   return { wager: wager(row), wallet: await this.economy.snapshot(c, input.profileId), replayed: false };
  });
 }
 async settle(entries: readonly { id: string; returned: number; outcome?: unknown }[], refund = false): Promise<Map<string, WalletState>> {
  if (!entries.length) return new Map();
  if (new Set(entries.map(e => e.id)).size !== entries.length || entries.some(e => !Number.isSafeInteger(e.returned) || e.returned < 0)) throw new Error('Invalid casino settlement');
  return this.economy.transaction(async c => {
   const rows = (await c.query('SELECT * FROM casino_wagers WHERE id=ANY($1::uuid[])', [entries.map(e => e.id)])).rows;
   if (rows.length !== entries.length) throw new Error('Unknown casino wager in settlement');
   const profiles = [...new Set<string>(rows.map(r => r.profile_id))].sort();
   for (const profile of profiles) await this.economy.lock(c, profile);
   const locked = (await c.query('SELECT * FROM casino_wagers WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [entries.map(e => e.id)])).rows;
   const amounts = new Map(entries.map(e => [e.id, e.returned]));
   const outcomes = new Map(entries.map(e => [e.id, e.outcome ?? null]));
   for (const row of locked) {
    const returned = amounts.get(row.id)!;
    if (returned > (row.game === 'roulette' ? row.stake * 36 : 5000)) throw new Error('Invalid casino settlement');
    if (refund && returned !== row.stake) throw new Error('Casino refund must return the original stake');
    if (row.status !== 'pending') {
     // Recovery racing an already committed settlement never replaces the result.
     if (!refund && (row.status !== 'settled' || row.returned !== returned)) throw new Error('Conflicting casino settlement');
     continue;
    }
    await c.query('UPDATE casino_wagers SET status=$2,returned=$3,outcome=$4,settled_at=now() WHERE id=$1', [row.id, refund ? 'refunded' : 'settled', returned, outcomes.get(row.id)]);
    await c.query('INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,$2,$3,$4)', [row.profile_id, `casino:return:${row.id}`, refund ? 'casino_refund' : 'casino_return', returned]);
    await c.query('UPDATE economy_wallets SET balance=balance+$2,revision=revision+1 WHERE profile_id=$1', [row.profile_id, returned]);
   }
   const snapshots = new Map<string, WalletState>();
   for (const profile of profiles) snapshots.set(profile, await this.economy.snapshot(c, profile));
   return snapshots;
  });
 }
 async recoverPending(roomId?: string): Promise<Map<string, WalletState>> {
  const rows = (await this.economy.pool.query('SELECT id,stake FROM casino_wagers WHERE status=\'pending\' AND ($1::text IS NULL OR room_id=$1) ORDER BY id', [roomId ?? null])).rows;
  const wallets = await this.settle(rows.map(r => ({ id: r.id, returned: r.stake })), true);
  for (const [id, wallet] of await this.poker.recover(roomId)) wallets.set(id, wallet);
  return wallets;
 }
}
