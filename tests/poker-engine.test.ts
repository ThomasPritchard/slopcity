import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PokerService } from '../server/casino/poker.ts';
import { pokerDeck } from '../server/casino/pokerRules.ts';
import { EconomyError } from '../server/persistence/economy.ts';
import type { PokerRepositoryLike, PokerBuyIn, PokerTransfer, PokerEscrow, PokerHandStart, PokerAllocation } from '../server/persistence/pokerTypes.ts';
import type { PokerCommand, PokerMove } from '../shared/poker.ts';
import { STARTER_OUTFIT, type WalletState } from '../shared/catalog.ts';
class MemoryPoker implements PokerRepositoryLike {
 escrows = new Map<string, PokerEscrow>(); balances = new Map<string, number>(); buys = new Map<string, { input: PokerBuyIn; id: string }>(); hands = new Map<string, PokerHandStart>(); settled = new Map<string, PokerEscrow[]>();
 failBegin = false; ambiguousBegin = false; failFinish = false; ambiguousFinish = false; ambiguousBuy = false; ambiguousCashout = false; starts: PokerHandStart[] = []; finishes: { handId: string; allocations: PokerAllocation[] }[] = [];
 wallet(id: string): WalletState { return { balance: this.balances.get(id) ?? 2000, revision: 1, salaryProgressMs: 0, owned: Object.values(STARTER_OUTFIT), outfit: { ...STARTER_OUTFIT } }; }
 async replay(profileId: string, requestId: string, fingerprint: string): Promise<PokerTransfer | null> { const saved = this.buys.get(`${profileId}:${requestId}`); if (!saved) return null; if (saved.input.fingerprint !== fingerprint) throw new EconomyError('request_conflict', 'Conflict'); return { escrow: { ...this.escrows.get(saved.id)! }, wallet: this.wallet(profileId), replayed: true }; }
 async buyIn(input: PokerBuyIn, validate: () => void) {
  const prior = await this.replay(input.profileId, input.requestId, input.fingerprint); if (prior) return prior;
  validate(); const balance = this.wallet(input.profileId).balance; if (balance < input.amount) throw new EconomyError('insufficient_funds', 'Insufficient funds');
  const escrow: PokerEscrow = { id: randomUUID(), profileId: input.profileId, roomId: input.roomId, tableId: 'poker-1', seat: input.seat, stack: input.amount, revision: 1, status: 'open', activeHandId: null };
  this.escrows.set(escrow.id, escrow); this.buys.set(`${input.profileId}:${input.requestId}`, { input: { ...input }, id: escrow.id }); this.balances.set(input.profileId, balance - input.amount);
  if (this.ambiguousBuy) { this.ambiguousBuy = false; throw new Error('Lost buy reply'); }
  return { escrow: { ...escrow }, wallet: this.wallet(input.profileId), replayed: false };
 }
 async beginHand(input: PokerHandStart) {
  this.starts.push(structuredClone(input)); if (this.failBegin) throw new Error('Database unavailable');
  if (!this.hands.has(input.handId)) { this.hands.set(input.handId, structuredClone(input)); for (const e of input.roster) this.escrows.get(e.id)!.activeHandId = input.handId; }
  if (this.ambiguousBegin) { this.ambiguousBegin = false; throw new Error('Lost begin reply'); }
 }
 async finishHand(handId: string, allocations: PokerAllocation[]) {
  this.finishes.push(structuredClone({ handId, allocations })); if (this.failFinish) throw new Error('Database unavailable');
  if (!this.settled.has(handId)) {
   const rows = allocations.map(a => { const e = this.escrows.get(a.escrowId)!; e.stack = a.stack; e.activeHandId = null; e.revision++; return { ...e }; }); this.settled.set(handId, rows);
  }
  if (this.ambiguousFinish) { this.ambiguousFinish = false; throw new Error('Lost finish reply'); }
  return structuredClone(this.settled.get(handId)!);
 }
 async cashOut(id: string) {
  const e = this.escrows.get(id)!; assert.equal(e.activeHandId, null);
  if (e.status === 'open') { this.balances.set(e.profileId, this.wallet(e.profileId).balance + e.stack); e.status = 'closed'; e.revision++; }
  if (this.ambiguousCashout) { this.ambiguousCashout = false; throw new Error('Lost cashout reply'); }
  return { escrow: { ...e }, wallet: this.wallet(e.profileId), replayed: false };
 }
}
function setup() {
 let time = 1000, deckCalls = 0;
 const actors = new Map(Array.from({ length: 6 }, (_, i) => [`p${i}`, { sessionId: `s${i}`, name: `Player ${i}`, x: 0, z: 0 }]));
 const repo = new MemoryPoker();
 const eligible = (id: string, session: string) => { const a = actors.get(id); if (!a || a.sessionId !== session) throw new EconomyError('session_ended', 'Ended'); if (a.x > 10) throw new EconomyError('too_far', 'Too far'); };
 const service = new PokerService('room', repo, { actor: id => actors.get(id), eligible, canJoin: eligible, wallet: () => {} }, { now: () => time, deck: () => { deckCalls++; return pokerDeck(() => 0); } });
 const command = (id: string, action: Omit<Extract<PokerCommand, { action: 'poker-action' }>, 'requestId' | 'tableId'> | Omit<Extract<PokerCommand, { action: 'poker-join' }>, 'requestId' | 'tableId'> | Omit<Extract<PokerCommand, { action: 'poker-rejoin' | 'poker-leave' }>, 'requestId' | 'tableId'>, requestId = randomUUID()) => service.handle(id, { ...action, tableId: 'poker-1', requestId } as PokerCommand, actors.get(id)?.sessionId);
 const join = (seat: number, buyIn = 500) => command(`p${seat}`, { action: 'poker-join', seat, buyIn });
 const act = (move: PokerMove, raiseTo?: number) => { const id = `p${service.state().activeSeat}`; const own = service.privateState(id)!; return command(id, { action: 'poker-action', handId: own.handId!, turnId: own.actions!.turnId, move, ...(raiseTo !== undefined ? { raiseTo } : {}) }); };
 const tick = async (ms = 8000) => { time += ms; await service.tick(); };
 return { service, repo, actors, command, join, act, tick, deckCalls: () => deckCalls };
}
test('Heads-up button posts small blind, acts first preflop; big blind keeps option and acts first postflop', async () => {
 const t = setup(); await t.join(0); await t.join(1); await t.tick();
 assert.equal(t.service.state().button, 0); assert.equal(t.service.state().smallBlindSeat, 0); assert.equal(t.service.state().bigBlindSeat, 1); assert.equal(t.service.state().activeSeat, 0);
 assert.equal(t.service.state().pot, 15); assert.equal(t.service.privateState('p0')!.actions!.callAmount, 5);
 await t.act('call'); assert.equal(t.service.state().activeSeat, 1); assert.equal(t.service.privateState('p1')!.actions!.canCheck, true);
 await t.act('check'); assert.equal(t.service.state().phase, 'flop'); assert.equal(t.service.state().activeSeat, 1);
 assert.equal(t.service.state().board.length, 3); assert.equal(t.repo.escrows.values().next().value!.stack, 500);
 assert.ok(t.service.state().seats.every(s => s.cards.every(c => c === null))); assert.equal(t.service.privateState('p0')!.holeCards.length, 2); assert.equal(t.service.privateState('nobody'), null);
});
test('Timeout checks when free, folds to a bet; uncontested winner never exposes cards', async () => {
 const t = setup(); await t.join(0); await t.join(1); await t.tick(); await t.tick(20_000);
 assert.equal(t.service.state().phase, 'result'); assert.equal(t.service.state().winners.reduce((n, w) => n + w.amount, 0), 10);
 assert.ok(t.service.state().seats.every(s => s.cards.every(c => c === null))); assert.deepEqual(t.service.state().seats.map(s => s.stack), [495, 505]);
 await t.tick(8000); assert.equal(t.service.state().button, 1); await t.act('call'); await t.tick(20_000); assert.equal(t.service.state().phase, 'flop');
});
test('All-in runout reveals only eligible showdown hands and conserves stacks', async () => {
 const t = setup(); await t.join(0, 200); await t.join(1, 200); await t.tick(); await t.act('all-in'); await t.act('call');
 assert.equal(t.service.state().phase, 'runout'); assert.equal(t.service.state().activeSeat, null);
 await t.command('p0', { action: 'poker-leave', escrowId: t.service.privateState('p0')!.escrowId });
 assert.equal(t.service.state().seats[0].state, 'all-in');
 for (let i = 0; i < 3; i++) await t.tick(1200);
 assert.equal(t.service.state().phase, 'result'); assert.equal(t.service.state().board.length, 5);
 assert.ok(t.service.state().seats.every(s => s.cards.every(c => c !== null))); assert.equal(t.service.state().seats.reduce((n, s) => n + s.stack, 0), 400);
 await t.tick(8000); assert.equal(t.service.hasSeat('p0'), false);
});
test('Action replay and turn fence prevent a duplicate call or changed request', async () => {
 const t = setup(); await t.join(0); await t.join(1); await t.tick();
 const priv = t.service.privateState('p0')!, requestId = randomUUID();
 const action = { action: 'poker-action' as const, handId: priv.handId!, turnId: priv.actions!.turnId, move: 'call' as const };
 await t.command('p0', action, requestId); const pot = t.service.state().pot;
 await t.command('p0', action, requestId); assert.equal(t.service.state().pot, pot);
 await assert.rejects(t.command('p0', { ...action, move: 'fold' }, requestId), (e: EconomyError) => e.code === 'request_conflict');
 await assert.rejects(t.command('p0', action), (e: EconomyError) => e.code === 'not_your_turn');
});
test('Single short all-in does not reopen; cumulative short all-ins reopen a full raise', async () => {
 for (const cumulative of [false, true]) {
  const t = setup(); for (const [seat, buy] of [[0, 300], [1, 500], [2, 500], [3, 1000], [4, 1000], [5, 200]]) await t.join(seat, buy);
  await t.tick(); assert.equal(t.service.state().activeSeat, 3);
  await t.act('raise', 150); await t.act('call'); await t.act('all-in');
  assert.equal(t.service.state().currentBet, 200);
  await t.act(cumulative ? 'all-in' : 'fold'); await t.act('fold'); await t.act('fold');
  assert.equal(t.service.state().activeSeat, 3);
  const legal = t.service.privateState('p3')!.actions!;
  assert.equal(legal.canRaise, cumulative); assert.equal(legal.canAllIn, cumulative);
  assert.equal(legal.minRaiseTo, cumulative ? 440 : 340);
  if (cumulative) await t.act('raise', 440); else { await assert.rejects(t.act('raise', 340), (e: EconomyError) => e.code === 'invalid_raise'); await t.act('call'); }
 }
});
test('Disconnect reserves hand seat, rejoin changes session without debit and cannot resurrect a fold', async () => {
 const t = setup(); await t.join(0); await t.join(1); await t.join(2); await t.tick();
 const own = t.service.privateState('p0')!, balance = t.repo.wallet('p0').balance;
 t.service.leave('p0'); t.actors.get('p0')!.sessionId = 'replacement';
 assert.equal(t.service.privateState('p0')!.canRejoin, true); assert.equal(t.service.hasSeat('p0'), true);
 await t.command('p0', { action: 'poker-rejoin', escrowId: own.escrowId });
 assert.deepEqual(t.service.privateState('p0')!.holeCards, own.holeCards); assert.equal(t.repo.wallet('p0').balance, balance);
 await t.act('fold'); t.service.leave('p0'); t.actors.get('p0')!.sessionId = 'replacement-2';
 await t.command('p0', { action: 'poker-rejoin', escrowId: own.escrowId }); assert.equal(t.service.state().seats[0].state, 'folded'); assert.equal(t.service.privateState('p0')!.actions, null);
});
test('Leaving out of turn preserves active turn/deadline and cashes out only after settlement', async () => {
 const t = setup(); await t.join(0); await t.join(1); await t.join(2); await t.tick();
 const active = t.service.state().activeSeat, deadline = t.service.state().deadline, turnId = t.service.privateState(`p${active}`)!.actions!.turnId;
 await t.command('p1', { action: 'poker-leave', escrowId: t.service.privateState('p1')!.escrowId });
 assert.equal(t.service.state().activeSeat, active); assert.equal(t.service.state().deadline, deadline); assert.equal(t.service.privateState(`p${active}`)!.actions!.turnId, turnId);
 assert.equal(t.service.hasSeat('p1'), true); await t.act('fold'); await t.tick(8000); assert.equal(t.service.hasSeat('p1'), false);
});
test('Ambiguous buy-in, begin, finish and cash-out retain payloads and apply once', async () => {
 const t = setup(), requestId = randomUUID(); t.repo.ambiguousBuy = true;
 const join = { action: 'poker-join' as const, seat: 0, buyIn: 500 };
 await assert.rejects(t.command('p0', join, requestId)); assert.equal(t.repo.wallet('p0').balance, 1500); assert.equal(t.service.state().phase, 'paused');
 await t.command('p0', join, requestId); assert.equal(t.service.state().seats.length, 1); await t.join(1);
 t.repo.ambiguousBegin = true; await t.tick(); assert.equal(t.service.state().phase, 'paused'); assert.equal(t.deckCalls(), 0); assert.ok(t.service.state().seats.every(s => s.cards.length === 0));
 await t.tick(); assert.deepEqual(t.repo.starts[0], t.repo.starts[1]); assert.equal(t.deckCalls(), 1);
 t.repo.ambiguousFinish = true; await t.act('fold'); assert.equal(t.service.state().phase, 'paused'); assert.deepEqual(t.service.state().winners, []);
 await t.tick(); assert.equal(t.service.state().phase, 'result'); assert.deepEqual(t.repo.finishes[0], t.repo.finishes[1]); assert.equal(t.repo.settled.size, 1);
 const id = t.service.privateState('p0')!.escrowId; t.repo.ambiguousCashout = true;
 const leave = { action: 'poker-leave' as const, escrowId: id }, leaveId = randomUUID();
 await assert.rejects(t.command('p0', leave, leaveId)); const balance = t.repo.wallet('p0').balance;
 await t.command('p0', leave, leaveId); assert.equal(t.repo.wallet('p0').balance, balance); assert.equal(t.service.hasSeat('p0'), false);
 await t.command('p0', leave, leaveId); assert.equal(t.repo.wallet('p0').balance, balance);
});
test('Idle table waits without creating hands; departed single-player stack cashes out', async () => {
 const t = setup(); await t.join(0); for (let i = 0; i < 3; i++) await t.tick(20_000);
 assert.equal(t.repo.hands.size, 0); assert.equal(t.service.state().phase, 'waiting');
 t.service.leave('p0'); await t.tick(); assert.equal(t.service.hasSeat('p0'), false); assert.equal(t.repo.wallet('p0').balance, 2000);
});
test('Eight-second initial countdown admits six between-hand joins and fences midhand buy-ins', async () => {
 const t = setup(); await t.join(0); await t.join(1); const deadline = t.service.state().deadline;
 await t.tick(4000); assert.equal(t.service.state().phase, 'waiting'); assert.equal(t.repo.hands.size, 0);
 for (const i of [2, 3, 4]) await t.join(i); assert.equal(t.service.state().deadline, deadline);
 await t.tick(4000); assert.equal(t.service.state().phase, 'preflop');
 await assert.rejects(t.join(5), (e: EconomyError) => e.code === 'hand_in_progress'); assert.equal(t.repo.wallet('p5').balance, 2000);
});
test('Leaving during all-in runout preserves the sole side-pot eligible player', async () => {
 const t = setup(); await t.join(0, 200); await t.join(1); await t.join(2); await t.tick();
 await t.act('all-in'); await t.act('raise', 400); await t.act('call');
 assert.equal(t.service.state().phase, 'flop'); assert.equal(t.service.state().activeSeat, 1);
 await t.act('fold'); assert.equal(t.service.state().phase, 'runout');
 await t.command('p2', { action: 'poker-leave', escrowId: t.service.privateState('p2')!.escrowId });
 assert.equal(t.service.state().seats[2].state, 'playing');
 await t.tick(1200); await t.tick(1200);
 assert.equal(t.service.state().phase, 'result'); assert.equal(t.service.state().pot, 1000);
 assert.ok(t.service.state().pots.some(p => p.amount === 400 && p.eligibleSeats.join() === '2' && p.winnerSeats.join() === '2'));
 assert.equal(t.service.state().seats.reduce((sum, s) => sum + s.stack, 0), 1200);
 assert.ok(t.service.state().seats[1].cards.every(c => c === null));
});
test('Failed begin/finish retries freeze roster, cards and allocations until acknowledged', async () => {
 const t = setup(); await t.join(0); await t.join(1); t.repo.failBegin = true;
 await t.tick(); await t.tick(1000); assert.equal(t.deckCalls(), 0); assert.deepEqual(t.repo.starts[0], t.repo.starts[1]);
 t.repo.failBegin = false; await t.tick(1000); assert.equal(t.deckCalls(), 1);
 t.repo.failFinish = true; await t.act('fold'); const stacks = t.service.state().seats.map(s => s.stack);
 await t.tick(1000); assert.deepEqual(t.repo.finishes[0], t.repo.finishes[1]); assert.deepEqual(t.service.state().seats.map(s => s.stack), stacks); assert.equal(t.service.state().phase, 'paused');
 t.repo.failFinish = false; await t.tick(1000); assert.equal(t.service.state().phase, 'result'); assert.equal(t.repo.settled.size, 1);
});
test('Turn-ordered departures cannot orphan a side pot when two higher contributors leave out of turn', async () => {
 const t = setup(); await t.join(0, 200); await t.join(1); await t.join(2); await t.join(3); await t.tick();
 await t.act('raise', 200); await t.act('call'); await t.act('raise', 400); await t.act('call');
 assert.equal(t.service.state().activeSeat, 3); assert.deepEqual(t.service.state().seats.map(s => s.committed), [200, 400, 400, 200]);
 const turn = t.service.privateState('p3')!.actions!.turnId, deadline = t.service.state().deadline;
 for (const id of ['p1', 'p2']) await t.command(id, { action: 'poker-leave', escrowId: t.service.privateState(id)!.escrowId });
 assert.equal(t.service.privateState('p3')!.actions!.turnId, turn); assert.equal(t.service.state().deadline, deadline);
 assert.equal(t.service.state().seats[1].state, 'playing'); assert.equal(t.service.state().seats[2].state, 'playing');
 await t.act('fold');
 assert.equal(t.service.state().phase, 'runout'); assert.equal(t.service.state().seats[1].state, 'folded'); assert.equal(t.service.state().seats[2].state, 'playing');
 await t.tick(1200); await t.tick(1200);
 assert.equal(t.service.state().phase, 'result');
 assert.ok(t.service.state().pots.every(p => p.eligibleSeats.length > 0));
 assert.ok(t.service.state().pots.some(p => p.amount === 400 && p.eligibleSeats.join() === '2'));
 assert.equal(t.service.state().seats.reduce((sum, s) => sum + s.stack, 0), 1700);
});
test('Diverse legal action sequences terminate and conserve every escrow chip', async () => {
 let seed = 1729; const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
 for (let scenario = 0; scenario < 24; scenario++) {
  const t = setup(), count = 2 + random(5); for (let seat = 0; seat < count; seat++) await t.join(seat); await t.tick();
  let steps = 0;
  while (t.service.state().phase !== 'result') {
   assert.ok(steps++ < 200, 'Hand must make bounded progress');
   if (t.service.state().phase === 'runout') { await t.tick(1200); continue; }
   const legal = t.service.privateState(`p${t.service.state().activeSeat}`)!.actions!;
   const moves: PokerMove[] = ['fold', legal.canCheck ? 'check' : 'call'];
   if (legal.canRaise) moves.push('raise'); if (legal.canAllIn) moves.push('all-in');
   const move = moves[random(moves.length)]; await t.act(move, move === 'raise' ? legal.minRaiseTo : undefined);
  }
  assert.equal(t.service.state().seats.reduce((sum, s) => sum + s.stack, 0), count * 500);
  assert.equal(t.repo.settled.size, 1); assert.ok(t.service.state().pots.every(p => p.eligibleSeats.length > 0));
 }
});
test('Unequal heads-up all-ins display only the contested pot after durable settlement', async () => {
 const t = setup(); await t.join(0, 400); await t.join(1, 200); await t.tick(); await t.act('all-in'); await t.act('call');
 assert.equal(t.service.state().pot, 600);
 await t.tick(1200); await t.tick(1200); t.repo.ambiguousFinish = true; await t.tick(1200);
 assert.equal(t.service.state().phase, 'paused'); assert.equal(t.service.state().pot, 600);
 await t.tick(1000);
 const view = t.service.state();
 assert.equal(view.phase, 'result'); assert.equal(view.pot, 400);
 assert.deepEqual(view.seats.map(s => s.committed), [200, 200]); assert.ok(view.seats.every(s => s.bet >= 0));
 assert.equal(view.winners.reduce((sum, w) => sum + w.amount, 0), 400);
 assert.equal(view.seats.reduce((sum, s) => sum + s.stack, 0), 600);
 assert.deepEqual(t.repo.finishes[0], t.repo.finishes[1]);
 assert.equal([...t.repo.escrows.values()].reduce((sum, e) => sum + e.stack, 0), 600);
});
