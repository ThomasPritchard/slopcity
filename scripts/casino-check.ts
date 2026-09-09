import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { GuestRepository } from '../server/persistence/guests.ts';
import { EconomyRepository, EconomyError } from '../server/persistence/economy.ts';
import { CasinoRepository, type WagerInput } from '../server/persistence/casino.ts';
loadEnvFile('.env');
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const schema = `casino_test_${randomUUID().replaceAll('-', '')}`;
const url = new URL(process.env.DATABASE_URL!); url.searchParams.set('options', `-c search_path=${schema}`);
const guests = new GuestRepository(url.toString()), economy = new EconomyRepository(guests.pool), casino = new CasinoRepository(economy);
const input = (profileId: string, overrides: Partial<WagerInput> = {}): WagerInput => ({ profileId, requestId: randomUUID(), fingerprint: randomUUID(), roomId: 'test-room', tableId: 'roulette-1', roundId: randomUUID(), stake: 100, details: { game: 'roulette', bet: { kind: 'red' } }, ...overrides });
const valid = () => {};
try {
 await admin.query(`CREATE SCHEMA ${schema}`); await guests.initialise(); await economy.initialise(); await casino.initialise();
 await guests.initialise(); await economy.initialise(); await casino.initialise();
 const profile = async () => (await guests.create({ name: 'Casino test', shirt: 0, skin: 0 })).profile.id;
 const id = await profile(), same = input(id);
 const accepted = await Promise.all(Array.from({ length: 8 }, () => casino.accept(same, valid)));
 assert.ok(accepted.every(r => r.wallet.balance === 900 && r.wager.id === accepted[0].wager.id));
 assert.equal((await casino.accept(same, () => { throw new Error('Replay must precede eligibility'); })).wallet.balance, 900);
 await assert.rejects(casino.accept({ ...same, fingerprint: 'changed' }, valid), (e: EconomyError) => e.code === 'request_conflict');
 const returns = await Promise.all(Array.from({ length: 8 }, () => casino.settle([{ id: accepted[0].wager.id, returned: 200, outcome: { number: 1 } }])));
 assert.ok(returns.every(r => r.get(id)?.balance === 1100));
 assert.equal((await guests.pool.query('SELECT outcome FROM casino_wagers WHERE id=$1', [accepted[0].wager.id])).rows[0].outcome.number, 1);
 // Concurrent purchases, salary and wagers all serialize on the existing wallet row.
 const mixed = await profile(), epoch = randomUUID(); await economy.openSession(mixed, epoch);
 const attempts = await Promise.allSettled([
  economy.purchase(mixed, 'oxblood-boots', 'mixed-clothing'), economy.checkpoint(mixed, epoch, 600000),
  ...Array.from({ length: 8 }, () => casino.accept(input(mixed), valid)),
 ]);
 assert.equal(attempts[0].status, 'fulfilled'); assert.equal(attempts[1].status, 'fulfilled');
 const successfulBets = attempts.slice(2).filter(r => r.status === 'fulfilled').length;
 assert.equal((await economy.ensure(mixed)).balance, 1100 - 480 - successfulBets * 100);
 assert.ok(attempts.slice(2).filter(r => r.status === 'rejected').every(r => r.status === 'rejected' && r.reason instanceof EconomyError && r.reason.code === 'insufficient_funds'));
 // An insufficient additional blackjack debit never creates a wager; exact retry may succeed later.
 const poor = await profile(); await economy.purchase(poor, 'oxblood-boots', 'poor-boots'); await economy.purchase(poor, 'rust-bomber', 'poor-bomber');
 await casino.accept(input(poor), valid); const increment = input(poor, { tableId: 'blackjack-1', details: { game: 'blackjack', action: 'double' } });
 await assert.rejects(casino.accept(increment, valid), (e: EconomyError) => e.code === 'insufficient_funds');
 assert.equal(await casino.replay(poor, increment.requestId, increment.fingerprint), null);
 const poorEpoch = randomUUID(); await economy.openSession(poor, poorEpoch); await economy.checkpoint(poor, poorEpoch, 600000);
 assert.equal((await casino.accept(increment, valid)).wallet.balance, 0);
 // Admission waits behind a wallet lock and observes the new cutoff after it acquires it.
 const delayed = await profile(); await economy.ensure(delayed); const blocker = await guests.pool.connect(); let open = true;
 await blocker.query('BEGIN'); await blocker.query('SELECT profile_id FROM economy_wallets WHERE profile_id=$1 FOR UPDATE', [delayed]);
 const waiting = casino.accept(input(delayed), () => { if (!open) throw new EconomyError('betting_closed', 'Closed'); });
 const failure = assert.rejects(waiting, (e: EconomyError) => e.code === 'betting_closed');
 await delay(50); open = false; await blocker.query('COMMIT'); blocker.release(); await failure; assert.equal((await economy.ensure(delayed)).balance, 1000);
 // Simulate an acknowledgement lost after a real COMMIT, then replay through a fresh repository.
 const ambiguous = input(id); const original = economy.transaction.bind(economy); let loseReply = true;
 economy.transaction = async work => { const result = await original(work); if (loseReply) { loseReply = false; throw new Error('Simulated lost commit reply'); } return result; };
 await assert.rejects(casino.accept(ambiguous, valid), /lost commit/); economy.transaction = original;
 const fresh = new CasinoRepository(new EconomyRepository(guests.pool)); const replay = await fresh.accept(ambiguous, () => { throw new Error('Must not read stale eligibility'); });
 assert.equal(replay.replayed, true); assert.equal(replay.wallet.balance, 1000);
 // Recovery is repeatable, room scoped, and includes separately accepted split/double increments.
 const refundId = await profile(); const first = await casino.accept(input(refundId, { tableId: 'blackjack-2', details: { game: 'blackjack', action: 'bet' }, roomId: 'dispose-room' }), valid);
 await casino.accept(input(refundId, { tableId: 'blackjack-2', details: { game: 'blackjack', action: 'split' }, roomId: 'dispose-room' }), valid);
 await casino.accept(input(refundId, { roomId: 'other-room' }), valid);
 await fresh.recoverPending('dispose-room'); await fresh.recoverPending('dispose-room'); assert.equal((await economy.ensure(refundId)).balance, 900);
 const receipt = await fresh.replay(refundId, first.wager.requestId, first.wager.fingerprint); assert.equal(receipt?.wager.status, 'refunded');
 // Settlement and recovery race: exactly one terminal outcome wins; no double return.
 const raceId = await profile(); const race = await casino.accept(input(raceId, { roomId: 'race-room' }), valid);
 await Promise.allSettled([casino.settle([{ id: race.wager.id, returned: 200 }]), fresh.recoverPending('race-room')]);
 const terminal = (await guests.pool.query('SELECT status,returned FROM casino_wagers WHERE id=$1', [race.wager.id])).rows[0];
 assert.ok(['settled', 'refunded'].includes(terminal.status)); assert.equal((await economy.ensure(raceId)).balance, 900 + terminal.returned);
 await fresh.recoverPending(); await fresh.recoverPending();
 assert.equal((await guests.pool.query("SELECT count(*)::int AS count FROM casino_wagers WHERE status='pending'")).rows[0].count, 0);
 assert.equal((await economy.ensure(refundId)).balance, 1000);
 const ledger = await guests.pool.query("SELECT w.profile_id,w.balance,COALESCE(sum(l.amount),0)::int AS ledger FROM economy_wallets w LEFT JOIN economy_ledger l ON w.profile_id=l.profile_id GROUP BY w.profile_id,w.balance");
 assert.ok(ledger.rows.every(r => r.balance === r.ledger));
 console.log('PASS: casino migration/restart, concurrent debit/replay/conflict, shared clothing/salary serialization, insufficient blackjack increment retry, lock-delayed cutoff, committed-then-lost acknowledgement, durable outcome/settlement replay, room refund, terminal race and wallet-ledger reconciliation.');
} finally { await guests.close(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
