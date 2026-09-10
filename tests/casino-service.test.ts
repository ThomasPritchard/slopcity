import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CasinoService } from '../server/casino/service.ts';
import { CasinoRepository, type WagerResult, type WagerInput } from '../server/persistence/casino.ts';
import { EconomyError, type EconomyRepository } from '../server/persistence/economy.ts';
import { STARTER_OUTFIT, type WalletState } from '../shared/catalog.ts';
import { BLACKJACK_BETTING_MS, BLACKJACK_ACTION_MS, ROULETTE_BETTING_MS, ROULETTE_SPIN_MS, SLOTS_SPIN_MS, CASINO_RESULT_MS, type Card, type CasinoState, type CasinoReceipt, type BlackjackView, type RouletteView, type SlotsView } from '../shared/casino.ts';
class MemoryRepository extends CasinoRepository {
 rows = new Map<string, WagerResult>(); wallets = new Map<string, WalletState>(); ambiguous = false; failSettlement = false;
 constructor() { super(null as unknown as EconomyRepository); }
 wallet(id: string) { if (!this.wallets.has(id)) this.wallets.set(id, { balance: 1000, revision: 1, salaryProgressMs: 0, owned: Object.values(STARTER_OUTFIT), outfit: { ...STARTER_OUTFIT } }); return this.wallets.get(id)!; }
 override async replay(id: string, requestId: string, fingerprint: string) { const prior = this.rows.get(`${id}:${requestId}`); if (!prior) return null; if (prior.wager.fingerprint !== fingerprint) throw new EconomyError('request_conflict', 'Conflict'); return { ...prior, wallet: { ...this.wallet(id) }, replayed: true }; }
 override async accept(input: WagerInput, validate: () => void) {
  const prior = await this.replay(input.profileId, input.requestId, input.fingerprint); if (prior) return prior;
  validate(); const w = this.wallet(input.profileId); if (w.balance < input.stake) throw new EconomyError('insufficient_funds', 'Insufficient funds');
  w.balance -= input.stake; w.revision++;
  const result: WagerResult = { wager: { ...input, id: randomUUID(), status: 'pending', returned: null }, wallet: { ...w }, replayed: false };
  this.rows.set(`${input.profileId}:${input.requestId}`, result);
  if (this.ambiguous) { this.ambiguous = false; throw new Error('Lost commit acknowledgement'); }
  return result;
 }
 override async settle(entries: readonly { id: string; returned: number }[], refund = false) {
  if (this.failSettlement) throw new Error('Database unavailable');
  const snapshots = new Map<string, WalletState>();
  for (const entry of entries) { const r = [...this.rows.values()].find(r => r.wager.id === entry.id)!; if (r.wager.status === 'pending') { r.wager.status = refund ? 'refunded' : 'settled'; r.wager.returned = entry.returned; const w = this.wallet(r.wager.profileId); w.balance += entry.returned; w.revision++; } snapshots.set(r.wager.profileId, { ...this.wallet(r.wager.profileId) }); }
  return snapshots;
 }
 override async recoverPending(roomId?: string) { return this.settle([...this.rows.values()].filter(r => r.wager.status === 'pending' && (!roomId || r.wager.roomId === roomId)).map(r => ({ id: r.wager.id, returned: r.wager.stake })), true); }
}
function setup(ranks: Card['rank'][] = ['5', '9', '6', '7', '2', '3', '4', '10']) {
 let time = 1000; let state: CasinoState;
 const actors = new Map([['alice', { sessionId: 'session-a', name: 'Alice', x: 3, z: 19 }], ['bob', { sessionId: 'session-b', name: 'Bob', x: 3, z: 19 }]]);
 const receipts: CasinoReceipt[] = [], privateMessages: unknown[] = [], repo = new MemoryRepository();
 const service = new CasinoService('room', repo, { actor: id => actors.get(id), publish: s => { state = s; }, private: (_id, type, payload) => { if (type === 'casino-receipt') receipts.push(payload as CasinoReceipt); else privateMessages.push(payload); }, wallet: () => {} }, { now: () => time, random: () => 0, shoe: () => ranks.map(rank => ({ rank, suit: 'hearts' as const })).reverse() });
 const command = async (value: object, id = 'alice', requestId = randomUUID()) => { await service.handle(id, { ...value, requestId }); return receipts.at(-1)!; };
 const table = () => state!.tables.find(t => t.id === 'blackjack-1') as BlackjackView;
 const tick = async (ms = 0) => { time += ms; await service.tick(); };
 const begin = async (stake = 10) => { await command({ action: 'sync' }); await command({ action: 'blackjack-join', tableId: 'blackjack-1', seat: 0 }); await command({ action: 'blackjack-bet', tableId: 'blackjack-1', roundId: table().roundId, stake }); await tick(BLACKJACK_BETTING_MS); };
 return { service, repo, actors, receipts, command, table, tick, begin, state: () => state!, privateMessages };
}
test('Blackjack hit/stand replay consumes no extra card and dealer hole remains private', async () => {
 const t = setup(); await t.begin(); assert.equal(t.table().phase, 'playing'); assert.deepEqual(t.table().dealer, [{ rank: '9', suit: 'hearts' }, null]);
 assert.equal(t.table().dealerTotal, null); assert.equal(JSON.stringify(t.state()).includes('"shoe"'), false);
 const action = { action: 'blackjack-action', tableId: 'blackjack-1', roundId: t.table().roundId, hand: 0, move: 'hit' }, request = randomUUID();
 assert.equal((await t.command(action, 'alice', request)).ok, true); assert.equal(t.table().seats[0].hands[0].total, 13);
 await t.command(action, 'alice', request); assert.equal(t.table().seats[0].hands[0].cards.length, 3);
 assert.equal((await t.command({ ...action, move: 'stand' }, 'alice', request)).code, 'request_conflict');
 await t.command({ ...action, move: 'stand' }); await t.tick(); assert.equal(t.table().phase, 'result'); assert.equal(t.table().dealer.some(c => c === null), false);
 await t.service.dispose();
});
test('Blackjack natural pays 3:2, dealer peek pushes natural and defeats split-style ordinary 21', async () => {
 // Extra shoe cards let the dealer complete to 17+ once natural-only hands stopped excluding the draw.
 const win = setup(['A', '9', 'K', '7', '2', '3', '4', '6']); await win.begin(100); assert.equal(win.table().phase, 'result'); assert.equal(win.repo.wallet('alice').balance, 1150); await win.service.dispose();
 const push = setup(['A', 'A', 'K', 'Q']); await push.begin(10); assert.equal(push.table().phase, 'result'); assert.equal(push.repo.wallet('alice').balance, 1000); await push.service.dispose();
 const lose = setup(['5', 'A', '6', 'Q']); await lose.begin(10); assert.equal(lose.table().phase, 'result'); assert.equal(lose.repo.wallet('alice').balance, 990); await lose.service.dispose();
});
test('Split aces draw once and stand, split 21 pays ordinary win; identical-rank rule rejects ten/jack', async () => {
 const t = setup(['A', '9', 'A', '7', 'K', '9', '2']); await t.begin();
 await t.command({ action: 'blackjack-action', tableId: 'blackjack-1', roundId: t.table().roundId, hand: 0, move: 'split' }); await t.tick();
 assert.equal(t.table().phase, 'result'); assert.deepEqual(t.table().seats[0].hands.map(h => h.cards.length), [2, 2]); assert.equal(t.repo.wallet('alice').balance, 1020);
 assert.ok(t.table().seats[0].hands.every(h => h.outcome === 'win')); await t.service.dispose();
 const invalid = setup(['10', '9', 'J', '7', '2']); await invalid.begin();
 assert.equal((await invalid.command({ action: 'blackjack-action', tableId: 'blackjack-1', roundId: invalid.table().roundId, hand: 0, move: 'split' })).code, 'action_unavailable');
 assert.equal(invalid.repo.rows.size, 1); await invalid.service.dispose();
});
test('Unaffordable double does not consume a card; accepted double draws once, stands and retries safely', async () => {
 const t = setup(); await t.begin(); t.repo.wallet('alice').balance = 0;
 const action = { action: 'blackjack-action', tableId: 'blackjack-1', roundId: t.table().roundId, hand: 0, move: 'double' }, request = randomUUID();
 assert.equal((await t.command(action, 'alice', request)).code, 'insufficient_funds'); assert.equal(t.table().seats[0].hands[0].cards.length, 2);
 t.repo.wallet('alice').balance = 100; t.repo.ambiguous = true;
 assert.equal((await t.command(action, 'alice', request)).code, 'temporarily_unavailable'); assert.equal(t.table().phase, 'paused');
 await t.tick(1000); assert.equal(t.repo.rows.size, 2); assert.equal(t.table().seats[0].hands[0].cards.length, 3); assert.equal(t.table().seats[0].hands[0].stake, 20);
 await t.command(action, 'alice', request); assert.equal(t.table().seats[0].hands[0].cards.length, 3); await t.service.dispose();
});
test('Timeout and explicit departure stand hands, preserve wagers, and never automatically reclaim a seat', async () => {
 const t = setup(); await t.begin(); await t.tick(BLACKJACK_ACTION_MS); assert.equal(t.table().phase, 'result'); await t.service.dispose();
 const left = setup(); await left.begin(); await left.command({ action: 'leave', tableId: 'blackjack-1' }); await left.tick();
 assert.equal(left.table().seats[0].player.connected, false); assert.equal(left.table().phase, 'result'); await left.tick(CASINO_RESULT_MS); assert.equal(left.table().seats.length, 0); await left.service.dispose();
});
test('Roulette stays secret until committed settlement; ambiguous acceptance applies once after the deadline', async () => {
 const t = setup(); t.actors.get('alice')!.x = -8; t.actors.get('alice')!.z = 20; await t.command({ action: 'sync' });
 const roulette = () => t.state().tables.find(x => x.game === 'roulette') as RouletteView;
 const command = { action: 'roulette-bet', tableId: 'roulette-1', roundId: roulette().roundId, bet: { kind: 'straight', numbers: [0], stake: 10 } }, request = randomUUID();
 t.repo.ambiguous = true; await t.command(command, 'alice', request); assert.equal(roulette().phase, 'paused');
 await t.tick(ROULETTE_BETTING_MS); assert.equal(roulette().betCount, 1); assert.equal(roulette().result, null); assert.equal(roulette().phase, 'spinning');
 t.repo.failSettlement = true; await t.tick(ROULETTE_SPIN_MS); assert.equal(roulette().phase, 'paused'); assert.equal(roulette().result, null);
 t.repo.failSettlement = false; await t.tick(); assert.equal(roulette().result, 0); assert.equal(t.repo.wallet('alice').balance, 1350);
 t.actors.delete('alice'); assert.equal((await t.command(command, 'alice', request)).ok, true); assert.equal(t.repo.rows.size, 1); await t.service.dispose();
});
test('Slots commit before visual spin, exclude a second occupant and reveal no future reels', async () => {
 const t = setup(); for (const actor of t.actors.values()) { actor.x = -12; actor.z = 24; }
 t.repo.failSettlement = true; const request = randomUUID(); const command = { action: 'slots-spin', tableId: 'slots-1', stake: 10 };
 await t.command(command, 'alice', request); const slot = () => t.state().tables.find(x => x.id === 'slots-1') as SlotsView;
 assert.equal(slot().phase, 'paused'); assert.deepEqual(slot().reels, []); assert.equal(t.repo.wallet('alice').balance, 990);
 t.repo.failSettlement = false; await t.tick(1000); assert.equal(slot().phase, 'spinning'); assert.deepEqual(slot().reels, []); assert.equal(t.repo.wallet('alice').balance, 1020);
 assert.equal((await t.command(command, 'bob')).code, 'machine_busy');
 await t.tick(SLOTS_SPIN_MS); assert.deepEqual(slot().reels, ['cherry', 'cherry', 'cherry']); assert.equal(slot().returned, 30);
 await t.tick(CASINO_RESULT_MS); assert.equal(slot().player, null); await t.service.dispose();
});
test('Malformed protocol, wrong station, stale session, occupancy and disposal do not lose credits', async () => {
 const t = setup(); await t.command({ action: 'sync' });
 assert.equal((await t.command({ action: 'slots-spin', tableId: 'blackjack-1', stake: 10 })).ok, false);
 assert.equal((await t.command({ action: 'blackjack-join', tableId: 'blackjack-1', seat: -1 })).ok, false);
 await t.command({ action: 'blackjack-join', tableId: 'blackjack-1', seat: 0 });
 assert.equal((await t.command({ action: 'blackjack-join', tableId: 'blackjack-1', seat: 0 }, 'bob')).code, 'seat_taken');
 await t.command({ action: 'blackjack-bet', tableId: 'blackjack-1', roundId: t.table().roundId, stake: 10 });
 await t.service.dispose(); assert.equal(t.repo.wallet('alice').balance, 1000); assert.equal([...t.repo.rows.values()][0].wager.status, 'refunded');
});
test('Ambiguous blackjack admission survives leaving its reserved seat before retry', async () => {
 const t = setup(); await t.command({ action: 'sync' }); await t.command({ action: 'blackjack-join', tableId: 'blackjack-1', seat: 0 });
 t.repo.ambiguous = true;
 const command = { action: 'blackjack-bet', tableId: 'blackjack-1', roundId: t.table().roundId, stake: 10 }, request = randomUUID();
 await t.command(command, 'alice', request); await t.command({ action: 'leave', tableId: 'blackjack-1' });
 assert.equal(t.table().seats.length, 1); assert.equal(t.table().seats[0].player.connected, false);
 assert.equal((await t.command(command, 'alice', request)).ok, true); assert.equal(t.table().seats[0].hands.length, 1);
 await t.tick(BLACKJACK_BETTING_MS); assert.equal(t.table().phase, 'result'); assert.equal(t.repo.rows.size, 1); await t.service.dispose();
});
test('Pending slot settlement reserves occupancy and honours an explicit departure before apply', async () => {
 const t = setup(); t.actors.get('alice')!.x = -12; t.actors.get('alice')!.z = 24;
 t.repo.failSettlement = true; await t.command({ action: 'slots-spin', tableId: 'slots-1', stake: 10 });
 await t.command({ action: 'leave', tableId: 'slots-1' }); t.actors.get('alice')!.x = 3; t.actors.get('alice')!.z = 19;
 assert.equal((await t.command({ action: 'blackjack-join', tableId: 'blackjack-1', seat: 0 })).code, 'already_seated');
 t.repo.failSettlement = false; await t.tick(1000);
 const slot = t.state().tables.find(x => x.id === 'slots-1') as SlotsView; assert.equal(slot.player?.connected, false); await t.service.dispose();
});
test('A command from an old session cannot admit a replacement session after an await', async () => {
 const t = setup(); let entered!: () => void, release!: () => void;
 const waiting = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
 const original = t.repo.replay.bind(t.repo);
 t.repo.replay = async (...args) => { entered(); await gate; return original(...args); };
 const pending = t.command({ action: 'blackjack-join', tableId: 'blackjack-1', seat: 0 }); await waiting;
 t.actors.get('alice')!.sessionId = 'replacement'; release();
 assert.equal((await pending).code, 'session_ended'); assert.equal(t.repo.rows.size, 0); await t.service.dispose();
});
test('Dealer draws remain private while an unsuccessful settlement pauses the table', async () => {
 const t = setup(['10', '5', '8', '6', '7']); await t.begin(); t.repo.failSettlement = true;
 await t.command({ action: 'blackjack-action', tableId: 'blackjack-1', roundId: t.table().roundId, hand: 0, move: 'stand' }); await t.tick();
 assert.equal(t.table().phase, 'paused'); assert.deepEqual(t.table().dealer, [{ rank: '5', suit: 'hearts' }, null]);
 t.repo.failSettlement = false; await t.tick(); assert.equal(t.table().dealer.length, 3); assert.equal(t.table().dealerTotal, 18); await t.service.dispose();
});
test('Active-round hit receipts survive unrelated station receipt cache pressure', async () => {
 const t = setup(); await t.begin();
 const action = { action: 'blackjack-action', tableId: 'blackjack-1', roundId: t.table().roundId, hand: 0, move: 'hit' }, request = randomUUID();
 await t.command(action, 'alice', request);
 for (let i = 0; i < 4100; i++) await t.command({ action: 'blackjack-join', tableId: 'blackjack-1', seat: 1 }, 'bob');
 await t.command(action, 'alice', request); assert.equal(t.table().seats.find(s => s.player.profileId === 'alice')!.hands[0].cards.length, 3);
 await t.service.dispose();
});
