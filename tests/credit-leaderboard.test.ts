import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { GuestRepository } from '../server/persistence/guests.ts';
import { EconomyRepository } from '../server/persistence/economy.ts';
import { CasinoRepository } from '../server/persistence/casino.ts';

test('Global credit standings include offline wallets and escrow, preserve buy-in wealth, rank ties and exclude closed escrow', { skip: !process.env.DATABASE_URL }, async () => {
 const source = new URL(process.env.DATABASE_URL!);
 assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname));
 const admin = new Pool({ connectionString: source.toString() }), schema = `leaderboard_${randomUUID().replaceAll('-', '')}`;
 await admin.query(`CREATE SCHEMA ${schema}`); source.searchParams.set('options', `-c search_path=${schema}`);
 const guests = new GuestRepository(source.toString()), economy = new EconomyRepository(guests.pool), casino = new CasinoRepository(economy);
 try {
  await guests.initialise(); await economy.initialise(); await casino.initialise();
  const ids: string[] = [];
  for (let index = 0; index < 12; index++) {
   const id = (await guests.create({ name: `Neighbour ${index}`, shirt: 0, skin: 0 })).profile.id; ids.push(id); await economy.ensure(id);
   await guests.pool.query("UPDATE guest_profiles SET created_at='2026-01-01'::timestamptz + $2 * interval '1 day' WHERE id=$1", [id, index]);
  }
  let board = await economy.creditLeaderboard();
  assert.equal(board.entries.length, 10); assert.ok(board.entries.every(e => e.rank === 1 && e.credits === 1000));
  assert.deepEqual(board.entries.map(e => e.name), Array.from({ length: 10 }, (_, i) => `Neighbour ${i}`));
  await guests.pool.query('UPDATE economy_wallets SET balance=1500 WHERE profile_id=$1', [ids[0]]);
  const buy = (index: number) => casino.poker.buyIn({ profileId: ids[index], roomId: 'leaderboard-test', tableId: 'poker-1', seat: index, amount: 500, requestId: randomUUID(), fingerprint: randomUUID() }, () => {});
  const a = (await buy(0)).escrow, b = (await buy(1)).escrow;
  board = await economy.creditLeaderboard();
  assert.deepEqual(board.entries[0], { rank: 1, name: 'Neighbour 0', credits: 1500 });
  assert.equal(board.entries[1].rank, 2);
  const handId = randomUUID(); await casino.poker.beginHand({ handId, roomId: 'leaderboard-test', tableId: 'poker-1', roster: [a, b] });
  assert.deepEqual((await economy.creditLeaderboard()).entries, board.entries, 'Starting a hand does not erase committed chips from wealth');
  await casino.poker.finishHand(handId, [{ escrowId: a.id, stack: 800 }, { escrowId: b.id, stack: 200 }]);
  const settled = await economy.creditLeaderboard(); assert.equal(settled.entries[0].credits, 1800);
  await casino.poker.cashOut(a.id); await casino.poker.cashOut(b.id);
  assert.deepEqual((await economy.creditLeaderboard()).entries, settled.entries, 'Cashout does not count the closed escrow twice');
  assert.deepEqual(Object.keys(settled.entries[0]).sort(), ['credits', 'name', 'rank']);
 } finally { await guests.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});
