import { SALARY_INTERVAL_MS } from '../shared/catalog.ts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
 await admin.query(`CREATE SCHEMA ${schema}`); await guests.initialise(); await economy.initialise();
 // Start from the deployed three-game schema, then exercise the additive upgrade.
 await guests.pool.query(await readFile(new URL('../server/persistence/migrations/003_casino.sql', import.meta.url), 'utf8'));
 await guests.pool.query('INSERT INTO guest_schema_migrations(version) VALUES(3)');
 await casino.initialise();
 await guests.initialise(); await economy.initialise(); await casino.initialise();
 const profile = async () => (await guests.create({ name: 'Casino test', shirt: 0, skin: 0 })).profile.id;
 // Larger roulette stakes upgrade without changing the other games or durable replay.
 assert.ok((await guests.pool.query('SELECT version FROM guest_schema_migrations WHERE version=7')).rowCount);
 const largeId = await profile();
 const largeInput = input(largeId, {stake: 1000});
 const large = await casino.accept(largeInput, valid);
 assert.equal(large.wallet.balance, 0);
 assert.equal((await casino.accept(largeInput, valid)).replayed, true);
 await assert.rejects(casino.settle([{id: large.wager.id, returned: 36001}]), /Invalid casino settlement/);
 await casino.settle([{id: large.wager.id, returned: 36000}]);
 await casino.settle([{id: large.wager.id, returned: 36000}]);
 assert.equal((await economy.ensure(largeId)).balance, 36000);
 const larger = await casino.accept(input(largeId, {stake: 110, roomId: 'large-refund'}), valid);
 await casino.recoverPending('large-refund'); await casino.recoverPending('large-refund');
 assert.equal((await economy.ensure(largeId)).balance, 36000);
 assert.equal((await casino.replay(largeId, larger.wager.requestId, larger.wager.fingerprint))?.wager.returned, 110);
 for (const stake of [1001, 1010, 110.5, 111]) await assert.rejects(casino.accept(input(largeId, {stake}), valid), (e: EconomyError) => e.code === 'invalid_stake');
 for (const game of ['blackjack', 'slots', 'craps']) await assert.rejects(casino.accept(input(largeId, {stake: 110, details: {game}}), valid), (e: EconomyError) => e.code === 'invalid_stake');
 // The database uses the actual game column, not a roulette-looking table ID.
 await assert.rejects(guests.pool.query("UPDATE casino_wagers SET game='blackjack' WHERE id=$1", [large.wager.id]), /casino_wagers_stake_check/);
 const lowId = await profile(); await economy.purchase(lowId, 'oat-knit', 'roulette-low-wallet');
 await assert.rejects(casino.accept(input(lowId, {stake: 1000}), valid), (e: EconomyError) => e.code === 'insufficient_funds');
 // Migration 004 remains compatible with all initializers; craps uses the same atomic ledger/recovery.
 assert.ok((await guests.pool.query('SELECT version FROM guest_schema_migrations WHERE version=4')).rowCount);
 const crapsId = await profile();
 const crapsInput = input(crapsId, { tableId: 'craps-1', details: { game: 'craps', bet: { kind: 'dont-pass', stake: 100 } }, roomId: 'craps-recovery' });
 const crapsAccepted = await casino.accept(crapsInput, valid);
 assert.equal(crapsAccepted.wallet.balance, 900);
 await casino.recoverPending('craps-recovery'); await casino.recoverPending('craps-recovery');
 assert.equal((await economy.ensure(crapsId)).balance, 1000);
 assert.equal((await casino.replay(crapsId, crapsInput.requestId, crapsInput.fingerprint))?.wager.status, 'refunded');
 const crapsSettled = await casino.accept(input(crapsId, { tableId: 'craps-1', details: { game: 'craps' } }), valid);
 await casino.settle([{ id: crapsSettled.wager.id, returned: 200, outcome: { dice: [3, 4] } }]);
 await casino.settle([{ id: crapsSettled.wager.id, returned: 200, outcome: { dice: [3, 4] } }]);
 assert.equal((await economy.ensure(crapsId)).balance, 1100);
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
  economy.purchase(mixed, 'oxblood-boots', 'mixed-clothing'), economy.checkpoint(mixed, epoch, SALARY_INTERVAL_MS),
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
 const poorEpoch = randomUUID(); await economy.openSession(poor, poorEpoch); await economy.checkpoint(poor, poorEpoch, SALARY_INTERVAL_MS);
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
