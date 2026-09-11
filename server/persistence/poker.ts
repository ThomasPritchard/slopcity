import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { EconomyError, EconomyRepository } from './economy.ts';
import { POKER_MIN_BUY_IN, POKER_MAX_BUY_IN, POKER_BUY_IN_STEP } from '../../shared/poker.ts';
import type { WalletState } from '../../shared/catalog.ts';
import type { PokerAllocation, PokerBuyIn, PokerEscrow, PokerHandStart, PokerRepositoryLike, PokerTransfer } from './pokerTypes.ts';

const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validStack = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647;
const escrow = (r: Record<string, any>): PokerEscrow => ({ id: r.id, profileId: r.profile_id, roomId: r.room_id, tableId: r.table_id, seat: r.seat, stack: r.stack, revision: r.revision, status: r.status, activeHandId: r.active_hand_id });
const rosterKey = (roster: PokerEscrow[]) => roster.map(s => ({ id: s.id, profileId: s.profileId, seat: s.seat, stack: s.stack, revision: s.revision })).sort((a, b) => a.id.localeCompare(b.id));

/** Durable table chips. A pending hand retains opening stacks until one conserved settlement commits. */
export class PokerRepository implements PokerRepositoryLike {
 constructor(readonly economy: EconomyRepository) {}
 private transaction<T>(work: (c: PoolClient) => Promise<T>) {
  return this.economy.transaction(async c => {
   // One poker table per town: serialize escrow transitions before acquiring wallet locks.
   // Other economy operations never acquire this lock, so wallet lock ordering stays acyclic.
   await c.query('SELECT pg_advisory_xact_lock(782641093)');
   return work(c);
  });
 }
 private async prior(c: PoolClient, profileId: string, requestId: string, expected: string): Promise<PokerTransfer | null> {
  if ((await c.query('SELECT 1 FROM casino_wagers WHERE profile_id=$1 AND request_id=$2', [profileId, requestId])).rowCount) throw new EconomyError('request_conflict', 'This request was used for another casino action');
  const r = (await c.query('SELECT s.*,r.fingerprint FROM poker_requests r JOIN poker_seats s ON s.id=r.escrow_id WHERE r.profile_id=$1 AND r.request_id=$2', [profileId, requestId])).rows[0];
  if (!r) return null;
  const wallet = await this.economy.snapshot(c, profileId);
  if (r.fingerprint !== expected) throw new EconomyError('request_conflict', 'This request was used for another poker buy-in', 409, wallet);
  return { escrow: escrow(r), wallet, replayed: true };
 }
 replay(profileId: string, requestId: string, expected: string) {
  return this.transaction(async c => { await this.economy.lock(c, profileId); return this.prior(c, profileId, requestId, expected); });
 }
 buyIn(input: PokerBuyIn, validate: () => void): Promise<PokerTransfer> {
  if (!Number.isInteger(input.seat) || input.seat < 0 || input.seat > 5 || !Number.isSafeInteger(input.amount) || input.amount < POKER_MIN_BUY_IN || input.amount > POKER_MAX_BUY_IN || input.amount % POKER_BUY_IN_STEP) throw new EconomyError('invalid_buy_in', 'Choose a seat and 100–1,000 credits in steps of 100');
  return this.transaction(async c => {
   await this.economy.lock(c, input.profileId);
   const prior = await this.prior(c, input.profileId, input.requestId, input.fingerprint);
   if (prior) return prior;
   const wallet = await this.economy.snapshot(c, input.profileId);
   validate();
   const occupied = (await c.query("SELECT profile_id FROM poker_seats WHERE status='open' AND (profile_id=$1 OR (room_id=$2 AND table_id=$3 AND seat=$4))", [input.profileId, input.roomId, input.tableId, input.seat])).rows;
   if (occupied.length) throw new EconomyError('seat_taken', 'This seat or your existing poker seat is still occupied', 409, wallet);
   if (wallet.balance < input.amount) throw new EconomyError('insufficient_funds', 'You need more credits for this buy-in', 409, wallet);
   const id = randomUUID();
   const row = (await c.query('INSERT INTO poker_seats(id,profile_id,room_id,table_id,seat,stack) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [id, input.profileId, input.roomId, input.tableId, input.seat, input.amount])).rows[0];
   await c.query('INSERT INTO poker_requests(profile_id,request_id,fingerprint,escrow_id) VALUES($1,$2,$3,$4)', [input.profileId, input.requestId, input.fingerprint, id]);
   await c.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,$2,'poker_buyin',$3)", [input.profileId, `poker:buyin:${id}`, -input.amount]);
   await c.query('UPDATE economy_wallets SET balance=balance-$2,revision=revision+1 WHERE profile_id=$1', [input.profileId, input.amount]);
   return { escrow: escrow(row), wallet: await this.economy.snapshot(c, input.profileId), replayed: false };
  });
 }
 beginHand(input: PokerHandStart, validate: () => void = () => {}): Promise<void> {
  const roster = rosterKey(input.roster), key = fingerprint({ roomId: input.roomId, tableId: input.tableId, roster });
  if (roster.length < 2 || roster.length > 6 || new Set(roster.map(s => s.id)).size !== roster.length || roster.some(s => !validStack(s.stack) || s.stack === 0)) throw new Error('Invalid poker hand roster');
  return this.transaction(async c => {
   const prior = (await c.query('SELECT start_fingerprint,status FROM poker_hands WHERE id=$1', [input.handId])).rows[0];
   if (prior) { if (prior.start_fingerprint !== key || prior.status !== 'pending') throw new Error('Conflicting poker hand start'); return; }
   const rows = (await c.query('SELECT * FROM poker_seats WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [roster.map(s => s.id)])).rows;
   if (rows.length !== roster.length || rows.some(r => {
    const s = roster.find(s => s.id === r.id)!;
    return r.status !== 'open' || r.active_hand_id || r.room_id !== input.roomId || r.table_id !== input.tableId || r.profile_id !== s.profileId || r.seat !== s.seat || r.stack !== s.stack || r.revision !== s.revision;
   })) throw new Error('Stale poker hand roster');
   validate();
   await c.query('INSERT INTO poker_hands(id,room_id,table_id,roster,start_fingerprint) VALUES($1,$2,$3,$4,$5)', [input.handId, input.roomId, input.tableId, JSON.stringify(roster), key]);
   await c.query('UPDATE poker_seats SET active_hand_id=$2 WHERE id=ANY($1::uuid[])', [roster.map(s => s.id), input.handId]);
  });
 }
 finishHand(handId: string, allocations: PokerAllocation[]): Promise<PokerEscrow[]> {
  const sorted = allocations.map(a => ({ escrowId: a.escrowId, stack: a.stack })).sort((a, b) => a.escrowId.localeCompare(b.escrowId));
  if (sorted.length < 2 || sorted.length > 6 || new Set(sorted.map(a => a.escrowId)).size !== sorted.length || sorted.some(a => !validStack(a.stack))) throw new Error('Invalid poker settlement');
  const key = fingerprint(sorted);
  return this.transaction(async c => {
   const hand = (await c.query('SELECT * FROM poker_hands WHERE id=$1 FOR UPDATE', [handId])).rows[0];
   if (!hand || hand.status === 'cancelled') throw new Error('Unknown or cancelled poker hand');
   const roster = hand.roster as ReturnType<typeof rosterKey>;
   if (hand.status === 'settled') {
    if (hand.settlement_fingerprint !== key) throw new Error('Conflicting poker settlement');
   } else {
    if (roster.length !== sorted.length || roster.some(s => !sorted.some(a => a.escrowId === s.id)) || roster.reduce((sum, s) => sum + s.stack, 0) !== sorted.reduce((sum, a) => sum + a.stack, 0)) throw new Error('Poker settlement must conserve every chip across the exact hand roster');
    const rows = (await c.query('SELECT * FROM poker_seats WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [roster.map(s => s.id)])).rows;
    if (rows.length !== roster.length || rows.some(r => r.status !== 'open' || r.active_hand_id !== handId || !roster.some(s => s.id === r.id && s.stack === r.stack && s.revision === r.revision))) throw new Error('Stale poker settlement');
    for (const a of sorted) await c.query('UPDATE poker_seats SET stack=$2,revision=revision+1,active_hand_id=NULL WHERE id=$1', [a.escrowId, a.stack]);
    await c.query("UPDATE poker_hands SET status='settled',allocations=$2,settlement_fingerprint=$3,settled_at=now() WHERE id=$1", [handId, JSON.stringify(sorted), key]);
   }
   return (await c.query('SELECT * FROM poker_seats WHERE id=ANY($1::uuid[]) ORDER BY seat', [roster.map(s => s.id)])).rows.map(escrow);
  });
 }
 private async cashOutLocked(c: PoolClient, row: Record<string, any>): Promise<PokerTransfer> {
  await this.economy.lock(c, row.profile_id);
  if (row.active_hand_id) throw new EconomyError('hand_in_progress', 'Your chips remain on the table until this hand finishes');
  const replayed = row.status === 'closed';
  if (!replayed) {
   await c.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,$2,'poker_cashout',$3)", [row.profile_id, `poker:cashout:${row.id}`, row.stack]);
   await c.query('UPDATE economy_wallets SET balance=balance+$2,revision=revision+1 WHERE profile_id=$1', [row.profile_id, row.stack]);
   row = (await c.query("UPDATE poker_seats SET status='closed',closed_at=now() WHERE id=$1 RETURNING *", [row.id])).rows[0];
  }
  return { escrow: escrow(row), wallet: await this.economy.snapshot(c, row.profile_id), replayed };
 }
 cashOut(escrowId: string): Promise<PokerTransfer> {
  return this.transaction(async c => {
   const row = (await c.query('SELECT * FROM poker_seats WHERE id=$1 FOR UPDATE', [escrowId])).rows[0];
   if (!row) throw new EconomyError('not_seated', 'This poker seat no longer exists');
   return this.cashOutLocked(c, row);
  });
 }
 recover(roomId?: string): Promise<Map<string, WalletState>> {
  return this.transaction(async c => {
   const cancelled = (await c.query("UPDATE poker_hands SET status='cancelled',settled_at=now() WHERE status='pending' AND ($1::text IS NULL OR room_id=$1) RETURNING id", [roomId ?? null])).rows;
   if (cancelled.length) await c.query('UPDATE poker_seats SET active_hand_id=NULL WHERE active_hand_id=ANY($1::uuid[])', [cancelled.map(r => r.id)]);
   const rows = (await c.query("SELECT * FROM poker_seats WHERE status='open' AND ($1::text IS NULL OR room_id=$1) ORDER BY profile_id FOR UPDATE", [roomId ?? null])).rows;
   const wallets = new Map<string, WalletState>();
   for (const row of rows) wallets.set(row.profile_id, (await this.cashOutLocked(c, row)).wallet);
   return wallets;
  });
 }
}
