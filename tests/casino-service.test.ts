import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CasinoService } from '../server/casino/service.ts';
import { ROULETTE_LANDING_LEAD_MS, ROULETTE_LANDING_MS, sampleRouletteMotion } from '../shared/rouletteMotion.ts';
import { CasinoRepository, type WagerResult, type WagerInput } from '../server/persistence/casino.ts';
import { EconomyError, type EconomyRepository } from '../server/persistence/economy.ts';
import { STARTER_OUTFIT, type WalletState } from '../shared/catalog.ts';
import { CASINO_ANCHORS, type CasinoPrivateState, BLACKJACK_BETTING_MS, BLACKJACK_ACTION_MS, ROULETTE_BETTING_MS, ROULETTE_SPIN_MS, SLOTS_SPIN_MS, CASINO_RESULT_MS, type Card, type CasinoState, type CasinoReceipt, type BlackjackView, type RouletteView, type SlotsView } from '../shared/casino.ts';
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
function setup(ranks: Card['rank'][] = ['5', '9', '6', '7', '2', '3', '4', '10'], random: (max: number) => number = () => 0) {
 let time = 1000; let state: CasinoState;
 const actors = new Map([['alice', { sessionId: 'session-a', name: 'Alice', x: -8, z: 28.1 }], ['bob', { sessionId: 'session-b', name: 'Bob', x: -8, z: 28.1 }]]);
 const receipts: CasinoReceipt[] = [], privateMessages: unknown[] = [], repo = new MemoryRepository();
 const service = new CasinoService('room', repo, { actor: id => actors.get(id), publish: s => { state = s; }, private: (_id, type, payload) => { if (type === 'casino-receipt') receipts.push(payload as CasinoReceipt); else privateMessages.push(payload); }, wallet: () => {} }, { now: () => time, random, shoe: () => ranks.map(rank => ({ rank, suit: 'hearts' as const })).reverse() });
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
 const t = setup(); t.actors.get('alice')!.x = 0; t.actors.get('alice')!.z = 30; await t.command({ action: 'sync' });
 const roulette = () => t.state().tables.find(x => x.game === 'roulette') as RouletteView;
 const command = { action: 'roulette-bet', tableId: 'roulette-1', roundId: roulette().roundId, bet: { kind: 'straight', numbers: [0], stake: 10 } }, request = randomUUID();
 t.repo.ambiguous = true; await t.command(command, 'alice', request); assert.equal(roulette().phase, 'paused');
 await t.tick(ROULETTE_BETTING_MS); assert.equal(roulette().betCount, 1); assert.equal(roulette().result, null); assert.equal(roulette().phase, 'spinning');
 const hiddenSpin = structuredClone(roulette().motion!);
 assert.equal(hiddenSpin.number, null); assert.equal(hiddenSpin.landingAt, null);
 t.repo.failSettlement = true; await t.tick(ROULETTE_SPIN_MS); assert.equal(roulette().phase, 'paused'); assert.equal(roulette().result, null);
 assert.deepEqual(roulette().motion, hiddenSpin);
 t.repo.failSettlement = false; await t.tick(); assert.equal(roulette().result, 0); assert.equal(t.repo.wallet('alice').balance, 1350);
 assert.equal(roulette().phase, 'landing'); assert.deepEqual(roulette().history, []);
 const sharedSpin = structuredClone(roulette().motion!);
 assert.equal(sharedSpin.number, 0); assert.equal(sharedSpin.startedAt, hiddenSpin.startedAt);
 assert.equal(sharedSpin.landingAt, t.state().serverTime + ROULETTE_LANDING_LEAD_MS);
 assert.deepEqual(sampleRouletteMotion(sharedSpin, t.state().serverTime), sampleRouletteMotion(hiddenSpin, t.state().serverTime));
 await t.command({ action: 'sync' }, 'bob'); assert.deepEqual(roulette().motion, sharedSpin, 'Late spectator receives the same motion');
 await t.tick(ROULETTE_LANDING_LEAD_MS + ROULETTE_LANDING_MS - 1); assert.equal(roulette().phase, 'landing');
 await t.tick(1); assert.equal(roulette().phase, 'result'); assert.deepEqual(roulette().history, [0]);
 const revision = t.repo.wallet('alice').revision;
 await t.tick(CASINO_RESULT_MS); assert.equal(roulette().phase, 'betting'); assert.equal(roulette().result, null);
 assert.deepEqual(roulette().motion, sharedSpin, 'Completed spin remains positioned during the next betting window');
 assert.equal(t.repo.wallet('alice').revision, revision, 'Landing never settles a wager twice');
 t.actors.delete('alice'); assert.equal((await t.command(command, 'alice', request)).ok, true); assert.equal(t.repo.rows.size, 1); await t.service.dispose();
});
test('Slots commit before visual spin, exclude a second occupant and reveal no future reels', async () => {
 const t = setup(); for (const actor of t.actors.values()) { actor.x = -14.6; actor.z = 27.55; }
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
 const t = setup(); t.actors.get('alice')!.x = -14.6; t.actors.get('alice')!.z = 27.55;
 t.repo.failSettlement = true; await t.command({ action: 'slots-spin', tableId: 'slots-1', stake: 10 });
 await t.command({ action: 'leave', tableId: 'slots-1' }); t.actors.get('alice')!.x = -8; t.actors.get('alice')!.z = 28.1;
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


test('Expanded registry admits every station and retains independent roulette rounds and private wagers', async () => {
 const t = setup(); await t.command({ action: 'sync' });
 assert.equal(t.state().tables.length, 34);
 assert.equal(new Set(t.state().tables.map(table => table.id)).size, 34);
 assert.equal(t.state().tables.find(table => table.id === 'poker-1')?.game, 'poker');
 // Poker escrow admission is covered by poker-engine and the authenticated poker network check.
 const r1 = t.state().tables.find(table => table.id === 'roulette-1') as RouletteView;
 const r2 = t.state().tables.find(table => table.id === 'roulette-2') as RouletteView;
 assert.notEqual(r1.roundId, r2.roundId);
 const actor = t.actors.get('alice')!;
 actor.x = 0; actor.z = 30;
 const first = { action: 'roulette-bet', tableId: r1.id, roundId: r1.roundId, bet: { kind: 'straight', numbers: [0], stake: 10 } };
 const requestId = randomUUID();
 assert.equal((await t.command(first, 'alice', requestId)).ok, true);
 assert.equal((await t.command({ ...first, tableId: r2.id, roundId: r2.roundId })).code, 'too_far');
 actor.z = 42;
 assert.equal((await t.command({ ...first, tableId: r2.id })).code, 'betting_closed');
 assert.equal((await t.command({ ...first, tableId: r2.id, roundId: r2.roundId })).ok, true);
 assert.equal((await t.command(first, 'alice', requestId)).ok, true);
 assert.equal(t.repo.rows.size, 2);
 assert.deepEqual((t.privateMessages.at(-1) as CasinoPrivateState).rouletteBets.map(b => b.tableId), ['roulette-1', 'roulette-2']);
 assert.deepEqual(t.state().tables.filter(table => table.game === 'roulette').map(table => table.betCount), [1, 1]);
 await t.tick(ROULETTE_BETTING_MS); await t.tick(ROULETTE_SPIN_MS);
 assert.equal(t.repo.wallet('alice').balance, 1700);
 for (const anchor of CASINO_ANCHORS.filter(a => a.game !== 'roulette' && a.game !== 'poker')) {
  actor.x = anchor.x; actor.z = anchor.z - 1.9;
  const action = anchor.game === 'craps' ? { action: 'craps-bet', roundId: t.state().tables.find(v => v.id === anchor.id)!.roundId, bet: { kind: 'pass', stake: 10 } } : anchor.game === 'slots' ? { action: 'slots-spin', stake: 10 } : { action: 'blackjack-join', seat: 2 };
  assert.equal((await t.command({ ...action, tableId: anchor.id })).ok, true, anchor.id);
  await t.command({ action: 'leave', tableId: anchor.id });
  if (anchor.game === 'slots') { await t.tick(SLOTS_SPIN_MS); await t.tick(CASINO_RESULT_MS); }
 }
 assert.equal((await t.command({ action: 'slots-spin', tableId: 'slots-25', stake: 10 })).code, 'invalid_table');
 await t.service.dispose();
});

test('Craps admission, private held wager, shooter authorization, landing and exact-once retries', async () => {
 let diceDraws = 0; const t = setup(undefined, max => { if (max === 6) diceDraws++; return 0; }); for (const a of t.actors.values()) { a.x = -11.5; a.z = 51.4; }
 const view = () => t.state().tables.find(v => v.game === 'craps')! as import('../shared/craps.ts').CrapsView;
 await t.command({ action: 'sync' });
 const bet = { action: 'craps-bet', tableId: 'craps-1', roundId: view().roundId, bet: { kind: 'dont-pass', stake: 10 } };
 for (const invalid of [{ kind: 'field', stake: 10 }, { kind: 'pass', stake: 11 }, { kind: 'pass', stake: 0 }, { kind: 'pass', stake: 110 }]) assert.equal((await t.command({ ...bet, bet: invalid })).code, 'invalid_bet');
 t.repo.ambiguous = true; const requestId = randomUUID();
 assert.equal((await t.command(bet, 'alice', requestId)).ok, false);
 await t.command(bet, 'alice', requestId); assert.equal(t.repo.rows.size, 1); assert.equal(t.repo.wallet('alice').balance, 990);
 assert.equal((await t.command(bet)).code, 'already_bet');
 assert.equal(JSON.stringify(view()).includes('stake'), false);
 await t.tick(20_000); assert.equal(view().phase, 'awaiting-roll');
 const roll = { action: 'craps-roll', tableId: 'craps-1', roundId: view().roundId, rollId: view().rollId };
 assert.equal((await t.command(roll, 'bob')).code, 'not_shooter');
 assert.equal((await t.command({ ...roll, rollId: 'stale-roll' })).code, 'invalid_roll');
 t.repo.failSettlement = true; await t.command(roll); assert.equal(view().phase, 'paused'); assert.equal(view().motion, null); assert.equal(view().result, null);
 t.repo.failSettlement = false; await t.tick(); assert.equal(view().phase, 'rolling'); assert.equal(view().result, null); assert.equal(t.repo.wallet('alice').balance, 1010);
 assert.equal((await t.command(roll)).code, 'invalid_roll'); assert.equal(diceDraws, 2);
 await t.tick(4700); assert.equal(view().result?.total, 2); assert.equal(view().phase, 'result');
 assert.equal((t.privateMessages.at(-1) as CasinoPrivateState).crapsBets?.length, 1);
 await t.tick(6000); assert.equal(view().phase, 'betting'); assert.equal((t.privateMessages.at(-1) as CasinoPrivateState).crapsBets?.length, 0);
 t.actors.get('alice')!.x = 0; assert.equal((await t.command(bet, 'alice', requestId)).ok, true);
 await t.service.dispose();
});
test('Craps empty windows stay idle and disconnected wagers auto-roll without extending deadline', async () => {
 const t = setup(); const view = () => t.state().tables.find(v => v.game === 'craps')! as import('../shared/craps.ts').CrapsView;
 await t.tick(20_000); assert.equal(view().phase, 'betting'); assert.equal(view().motion, null);
 Object.assign(t.actors.get('alice')!, { x: -11.5, z: 51.4 });
 await t.command({ action: 'craps-bet', tableId: 'craps-1', roundId: view().roundId, bet: { kind: 'pass', stake: 10 } });
 await t.tick(20_000); const deadline = view().deadline; t.actors.delete('alice'); t.service.leave('alice'); await t.tick();
 assert.equal(view().deadline, deadline); assert.equal(view().shooter, null);
 await t.tick(15_000); assert.equal(view().phase, 'rolling'); assert.equal(t.repo.wallet('alice').balance, 990);
 await t.service.dispose(); assert.equal(t.repo.wallet('alice').balance, 990);
});
test('Craps point holds wagers, blocks additional bets, makes point and rotates on seven-out', async () => {
 // Other roulette tables also draw from the injected RNG; supply craps faces only for max=6.
 const dice = [1, 1, 1, 2, 1, 1, 2, 2, 2, 3]; let draws = 0;
 const t = setup(undefined, max => max === 6 ? dice[draws++]! : 0);
 for (const a of t.actors.values()) Object.assign(a, { x: -11.5, z: 51.4 });
 const view = () => t.state().tables.find(v => v.game === 'craps')! as import('../shared/craps.ts').CrapsView;
 await t.command({ action: 'sync' });
 const bet = async (id: string) => t.command({ action: 'craps-bet', tableId: 'craps-1', roundId: view().roundId, bet: { kind: 'pass', stake: 10 } }, id);
 const roll = async () => { await t.command({ action: 'craps-roll', tableId: 'craps-1', roundId: view().roundId, rollId: view().rollId }); await t.tick(4700); };
 await bet('alice'); await bet('bob'); await t.tick(20_000); await roll(); assert.equal(view().point, 4); assert.equal(view().shooter?.profileId, 'alice');
 assert.ok([...t.repo.rows.values()].every(r => r.wager.status === 'pending'));
 await t.tick(6000); assert.equal((await bet('alice')).code, 'betting_closed'); await roll(); assert.equal(view().point, 4); assert.equal(view().result?.resolution, 'point-continues');
 await t.tick(6000); await roll(); assert.equal(view().point, null); assert.equal(t.repo.wallet('alice').balance, 1010); assert.equal(view().shooter?.profileId, 'alice');
 await t.tick(6000); await bet('alice'); await bet('bob'); await t.tick(20_000); await roll(); assert.equal(view().point, 6);
 await t.tick(6000); await roll(); assert.equal(view().result?.total, 7); assert.equal(view().shooter?.profileId, 'bob'); assert.equal(draws, 10);
 await t.service.dispose();
});
test('Unfinished craps wagers are refunded once on recovery', async () => {
 const t = setup(); Object.assign(t.actors.get('alice')!, { x: -11.5, z: 51.4 }); await t.command({ action: 'sync' });
 const view = t.state().tables.find(v => v.game === 'craps')!;
 await t.command({ action: 'craps-bet', tableId: 'craps-1', roundId: view.roundId, bet: { kind: 'pass', stake: 100 } });
 await t.service.dispose(); assert.equal(t.repo.wallet('alice').balance, 1000); await t.repo.recoverPending(); assert.equal(t.repo.wallet('alice').balance, 1000);
});
test('Craps seven-out preserves the departure replacement, including a second departure and reconnect', async () => {
 for (const bobAlsoLeaves of [false, true]) {
  const dice = [1, 1, 2, 3]; let index = 0;
  const t = setup(undefined, max => max === 6 ? dice[index++]! : 0);
  t.actors.set('carol', { sessionId: 'session-c', name: 'Carol', x: -11.5, z: 51.4 });
  for (const a of t.actors.values()) Object.assign(a, { x: -11.5, z: 51.4 });
  const view = () => t.state().tables.find(v => v.game === 'craps')! as import('../shared/craps.ts').CrapsView;
  await t.command({ action: 'sync' });
  for (const id of ['alice', 'bob', 'carol']) await t.command({ action: 'craps-bet', tableId: 'craps-1', roundId: view().roundId, bet: { kind: 'pass', stake: 10 } }, id);
  await t.tick(20_000);
  const roll = () => t.command({ action: 'craps-roll', tableId: 'craps-1', roundId: view().roundId, rollId: view().rollId });
  await roll(); await t.tick(4700); assert.equal(view().point, 4); await t.tick(6000);
  await roll(); assert.equal(view().phase, 'rolling');
  t.actors.delete('alice'); t.service.leave('alice'); await t.tick(); assert.equal(view().shooter?.profileId, 'bob');
  if (bobAlsoLeaves) { t.actors.delete('bob'); t.service.leave('bob'); await t.tick(); assert.equal(view().shooter?.profileId, 'carol'); }
  // Reconnecting the same profile restores its private wager, but its old session cannot reclaim the turn.
  t.actors.set('alice', { sessionId: 'session-a-new', name: 'Alice', x: -11.5, z: 51.4 });
  await t.command({ action: 'sync' });
  const own = (t.privateMessages.at(-1) as CasinoPrivateState).crapsBets!;
  assert.equal(own.length, 1); assert.equal(own[0].roundId, view().roundId);
  assert.equal(own[0].bet.stake, 10);
  await t.tick(4700); assert.equal(view().result?.total, 7);
  assert.equal(view().shooter?.profileId, bobAlsoLeaves ? 'carol' : 'bob');
  await t.tick(6000); assert.equal(view().shooter?.profileId, bobAlsoLeaves ? 'carol' : 'bob');
  await t.service.dispose();
 }
});

test('Leaving a settled casino seat allows the next station during the result display', async () => {
 const t = setup(); await t.begin(); await t.tick(BLACKJACK_ACTION_MS);
 assert.equal(t.table().phase, 'result');
 await t.command({ action: 'leave', tableId: 'blackjack-1' });
 Object.assign(t.actors.get('alice')!, { x: -14.6, z: 27.55 });
 assert.equal((await t.command({ action: 'slots-spin', tableId: 'slots-1', stake: 10 })).ok, true);
 await t.tick(SLOTS_SPIN_MS); await t.command({ action: 'leave', tableId: 'slots-1' });
 Object.assign(t.actors.get('alice')!, { x: -8, z: 28.1 });
 assert.equal((await t.command({ action: 'blackjack-join', tableId: 'blackjack-1', seat: 0 })).ok, true);
 await t.service.dispose();
});
