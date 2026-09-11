import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { GuestRepository } from '../server/persistence/guests.ts';
import { EconomyRepository, EconomyError } from '../server/persistence/economy.ts';
import { CasinoRepository } from '../server/persistence/casino.ts';
import type { PokerBuyIn } from '../server/persistence/pokerTypes.ts';

async function fixture() {
 const admin = new Pool({ connectionString: process.env.DATABASE_URL });
 const schema = `poker_test_${randomUUID().replaceAll('-', '')}`;
 await admin.query(`CREATE SCHEMA ${schema}`);
 const url = new URL(process.env.DATABASE_URL!); url.searchParams.set('options', `-c search_path=${schema}`);
 const guests = new GuestRepository(url.toString()), economy = new EconomyRepository(guests.pool), casino = new CasinoRepository(economy), repo = casino.poker;
 await guests.initialise(); await economy.initialise(); await casino.initialise();
 const profile = async () => (await guests.create({ name: 'Poker test', shirt: 0, skin: 0 })).profile.id;
 const input = (profileId: string, seat: number, roomId = 'poker-test'): PokerBuyIn => ({ profileId, seat, roomId, tableId: 'poker-1', amount: 500, requestId: randomUUID(), fingerprint: randomUUID() });
 return { guests, economy, casino, repo, profile, input, close: async () => { await guests.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } };
}
const valid = () => {};
test('poker escrow debits once, fences live hands, conserves settlement and retains replay after cashout', { skip: !process.env.DATABASE_URL }, async () => {
 const f = await fixture();
 try {
  await f.guests.initialise(); await f.economy.initialise(); await f.casino.initialise();
  const a = await f.profile(), b = await f.profile(), c = await f.profile(), buy = f.input(a, 0);
  const accepted = await Promise.all(Array.from({ length: 6 }, () => f.repo.buyIn(buy, valid)));
  assert.ok(accepted.every(r => r.escrow.id === accepted[0].escrow.id && r.wallet.balance === 500));
  const A = accepted[0].escrow, B = (await f.repo.buyIn(f.input(b, 1), valid)).escrow;
  assert.equal((await f.repo.buyIn(buy, () => { throw Error('Must replay first'); })).replayed, true);
  await assert.rejects(f.repo.buyIn({ ...buy, fingerprint: 'different' }, valid), (e: EconomyError) => e.code === 'request_conflict');
  const houseBet = { profileId: a, requestId: buy.requestId, fingerprint: 'house-bet', roomId: 'poker-test', tableId: 'roulette-1', roundId: randomUUID(), stake: 10, details: { game: 'roulette' } };
  await assert.rejects(f.casino.accept(houseBet, valid), (e: EconomyError) => e.code === 'request_conflict');
  await assert.rejects(f.casino.replay(a, buy.requestId, 'house-bet'), (e: EconomyError) => e.code === 'request_conflict');
  const separateHouse = await f.casino.accept({ ...houseBet, profileId: c, requestId: randomUUID() }, valid);
  await assert.rejects(f.repo.buyIn({ ...f.input(c, 2), requestId: separateHouse.wager.requestId }, valid), (e: EconomyError) => e.code === 'request_conflict');
  await f.casino.settle([{ id: separateHouse.wager.id, returned: 10 }]);
  await assert.rejects(f.repo.buyIn(f.input(c, 0), valid), (e: EconomyError) => e.code === 'seat_taken');
  await assert.rejects(f.repo.buyIn(f.input(a, 2), valid), (e: EconomyError) => e.code === 'seat_taken');
  const hand = { handId: randomUUID(), roomId: 'poker-test', tableId: 'poker-1' as const, roster: [A, B] };
  await f.repo.beginHand(hand); await f.repo.beginHand(hand, () => { throw Error('Must replay first'); });
  await assert.rejects(f.repo.cashOut(A.id), (e: EconomyError) => e.code === 'hand_in_progress');
  await assert.rejects(f.repo.finishHand(hand.handId, [{ escrowId: A.id, stack: 600 }, { escrowId: B.id, stack: 500 }]), /conserve/);
  await assert.rejects(f.repo.finishHand(hand.handId, [{ escrowId: A.id, stack: 500 }, { escrowId: randomUUID(), stack: 500 }]), /conserve/);
  const allocation = [{ escrowId: A.id, stack: 850 }, { escrowId: B.id, stack: 150 }];
  const settled = await f.repo.finishHand(hand.handId, allocation);
  assert.equal(settled.find(s => s.id === A.id)!.stack, 850);
  await f.repo.finishHand(hand.handId, [...allocation].reverse());
  await assert.rejects(f.repo.finishHand(hand.handId, [{ escrowId: A.id, stack: 800 }, { escrowId: B.id, stack: 200 }]), /Conflicting/);
  await assert.rejects(f.repo.beginHand({ ...hand, handId: randomUUID() }), /Stale/);
  const cash = await Promise.all(Array.from({ length: 6 }, () => f.repo.cashOut(A.id)));
  assert.ok(cash.every(r => r.wallet.balance === 1350));
  assert.equal((await f.repo.cashOut(B.id)).wallet.balance, 650);
  assert.equal((await f.repo.buyIn(buy, () => { throw Error('Old request cannot debit again'); })).escrow.status, 'closed');
  const ledger = (await f.guests.pool.query('SELECT w.profile_id,w.balance,sum(l.amount)::integer AS total FROM economy_wallets w JOIN economy_ledger l ON l.profile_id=w.profile_id GROUP BY w.profile_id,w.balance')).rows;
  assert.ok(ledger.every(r => r.balance === r.total));
  assert.equal((await f.guests.pool.query("SELECT count(*)::integer AS n FROM economy_ledger WHERE kind='poker_cashout'")).rows[0].n, 2);
 } finally { await f.close(); }
});

test('poker lost commit replies and restart recovery preserve committed stacks and unrelated rooms', { skip: !process.env.DATABASE_URL }, async () => {
 const f = await fixture();
 const original = f.economy.transaction.bind(f.economy);
 const loseReply = () => { let once = true; f.economy.transaction = async work => { const result = await original(work); if (once) { once = false; throw Error('Lost commit reply'); } return result; }; };
 try {
  const a = await f.profile(), b = await f.profile(), c = await f.profile(), buy = f.input(a, 0);
  loseReply(); await assert.rejects(f.repo.buyIn(buy, valid), /Lost commit/); f.economy.transaction = original;
  const A = (await f.repo.buyIn(buy, () => { throw Error('Replay first'); })).escrow;
  const B = (await f.repo.buyIn(f.input(b, 1), valid)).escrow;
  const C = (await f.repo.buyIn(f.input(c, 0, 'other-room'), valid)).escrow;
  const first = { handId: randomUUID(), roomId: 'poker-test', tableId: 'poker-1' as const, roster: [A, B] };
  loseReply(); await assert.rejects(f.repo.beginHand(first), /Lost commit/); f.economy.transaction = original;
  await f.repo.beginHand(first);
  const allocations = [{ escrowId: A.id, stack: 900 }, { escrowId: B.id, stack: 100 }];
  loseReply(); await assert.rejects(f.repo.finishHand(first.handId, allocations), /Lost commit/); f.economy.transaction = original;
  const nextRoster = await f.repo.finishHand(first.handId, allocations);
  const second = { ...first, handId: randomUUID(), roster: nextRoster };
  await f.repo.beginHand(second);
  const recovered = await f.casino.recoverPending('poker-test');
  assert.equal(recovered.get(a)?.balance, 1400); assert.equal(recovered.get(b)?.balance, 600);
  assert.equal(recovered.has(c), false); assert.equal((await f.economy.ensure(c)).balance, 500);
  assert.equal((await f.repo.recover('poker-test')).size, 0);
  await assert.rejects(f.repo.finishHand(second.handId, allocations), /cancelled/);
  assert.equal((await f.repo.replay(a, buy.requestId, buy.fingerprint))!.escrow.status, 'closed');
  loseReply(); await assert.rejects(f.repo.cashOut(C.id), /Lost commit/); f.economy.transaction = original;
  assert.equal((await f.repo.cashOut(C.id)).wallet.balance, 1000);
  const statuses = (await f.guests.pool.query('SELECT id,status FROM poker_hands')).rows;
  assert.equal(statuses.find(r => r.id === first.handId).status, 'settled'); assert.equal(statuses.find(r => r.id === second.handId).status, 'cancelled');
 } finally { f.economy.transaction = original; await f.close(); }
});
