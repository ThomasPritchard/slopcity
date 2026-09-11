import { createHash, randomUUID } from 'node:crypto';
import type { Card, CasinoReceipt } from '../../shared/casino.ts';
import type { WalletState } from '../../shared/catalog.ts';
import { POKER_SMALL_BLIND, POKER_BIG_BLIND, POKER_TURN_MS, POKER_BREAK_MS, POKER_RUNOUT_MS, POKER_MIN_BUY_IN, POKER_MAX_BUY_IN, POKER_BUY_IN_STEP, type PokerCommand, type PokerView, type PokerPrivateState, type PokerLegalActions } from '../../shared/poker.ts';
import type { PokerRepositoryLike, PokerEscrow } from '../persistence/pokerTypes.ts';
import { EconomyError } from '../persistence/economy.ts';
import { pokerDeck, pokerPots } from './pokerRules.ts';
import type { Random } from './rules.ts';
export type PokerHooks = {
 actor(profileId: string): { sessionId: string; name: string; x: number; z: number } | undefined;
 eligible(profileId: string, sessionId: string): void;
 canJoin(profileId: string, sessionId: string): void;
 wallet(profileId: string, wallet: WalletState): void;
};
type Seat = { escrow: PokerEscrow; sessionId: string; name: string; leaving: boolean; disconnected: boolean; cards: Card[]; stack: number; bet: number; committed: number; state: 'waiting' | 'playing' | 'folded' | 'all-in'; actedAt: number | null; needsAction: boolean };
type Pending = { run: () => Promise<void>; requestKey?: string; fingerprint?: string };
const fail = (code: string, message: string): never => { throw new EconomyError(code, message); };
/** Owned by CasinoService's serialized queue. No timers, independent wallet or local persistence. */
export class PokerService {
 private seats = new Map<number, Seat>();
 private view: PokerView = { id: 'poker-1', game: 'poker', roundId: randomUUID(), handId: null, phase: 'waiting', deadline: 0, button: null, smallBlindSeat: null, bigBlindSeat: null, activeSeat: null, board: [], pot: 0, currentBet: 0, seats: [], pots: [], winners: [], message: 'Two funded players start a hand' };
 private cards: Card[] = [];
 private turnId = '';
 private minRaise = POKER_BIG_BLIND;
 private showdown = false;
 private pending: Pending | null = null;
 private receipts = new Map<string, { fingerprint: string; receipt: CasinoReceipt }>();
 private now: () => number;
 private deck: () => Card[];
 constructor(readonly roomId: string, readonly repository: PokerRepositoryLike, private hooks: PokerHooks, options: { now?: () => number; random?: Random; deck?: () => Card[] } = {}) { this.now = options.now ?? Date.now; this.deck = options.deck ?? (() => pokerDeck(options.random)); }
 profiles() { return [...this.seats.values()].map(s => s.escrow.profileId); }
 hasSeat(profileId: string) { return !!this.own(profileId); }
 private own(profileId: string) { return [...this.seats.values()].find(s => s.escrow.profileId === profileId); }
 private connected(s: Seat) {
  if (s.disconnected || this.hooks.actor(s.escrow.profileId)?.sessionId !== s.sessionId) return false;
  try { this.hooks.eligible(s.escrow.profileId, s.sessionId); return true; } catch { return false; }
 }
 state(): PokerView {
  return structuredClone({ ...this.view, phase: this.pending ? 'paused' : this.view.phase, seats: [...this.seats.entries()].sort(([a], [b]) => a - b).map(([seat, s]) => ({ seat, player: { profileId: s.escrow.profileId, name: s.name, connected: this.connected(s) }, stack: s.stack, bet: s.bet, committed: s.committed, state: s.state, leaving: s.leaving, cards: this.showdown && s.state !== 'folded' ? s.cards : s.cards.map(() => null) })) });
 }
 private legal(s: Seat): PokerLegalActions | null {
  if (this.pending || this.view.activeSeat !== s.escrow.seat || s.state !== 'playing' || !this.connected(s)) return null;
  const due = Math.max(0, this.view.currentBet - s.bet), max = s.bet + s.stack;
  const reopened = s.actedAt === null || this.view.currentBet - s.actedAt >= this.minRaise;
  const otherCanRespond = [...this.seats.values()].some(other => other !== s && other.state === 'playing' && other.stack > 0);
  const canRaise = reopened && otherCanRespond && max >= this.view.currentBet + this.minRaise;
  return { turnId: this.turnId, canFold: true, canCheck: due === 0, canCall: due > 0, callAmount: Math.min(due, s.stack), canRaise, minRaiseTo: this.view.currentBet + this.minRaise, maxRaiseTo: max, canAllIn: max <= this.view.currentBet || (reopened && otherCanRespond) };
 }
 privateState(profileId: string): PokerPrivateState | null {
  const s = this.own(profileId); return s ? { tableId: 'poker-1', escrowId: s.escrow.id, seat: s.escrow.seat, handId: this.view.handId, holeCards: structuredClone(s.cards), actions: this.legal(s), canRejoin: !s.leaving && !this.connected(s) } : null;
 }
 private remember(key: string, fingerprint: string, receipt: CasinoReceipt) { this.receipts.set(key, { fingerprint, receipt }); if (this.receipts.size > 4096) this.receipts.delete(this.receipts.keys().next().value!); return receipt; }
 private async retry(): Promise<boolean> {
  const pending = this.pending; if (!pending) return true;
  try { await pending.run(); if (this.pending === pending) this.pending = null; return true; }
  catch (error) { if (error instanceof EconomyError) { this.pending = null; throw error; } return false; }
 }
 async handle(profileId: string, command: PokerCommand, originSession?: string): Promise<CasinoReceipt> {
  const key = `${profileId}:${command.requestId}`;
  // Canonical field order fences retries even when callers send object keys in another order.
  const canonical = command.action === 'poker-join' ? { action: command.action, requestId: command.requestId, tableId: command.tableId, seat: command.seat, buyIn: command.buyIn } : command.action === 'poker-action' ? { action: command.action, requestId: command.requestId, tableId: command.tableId, handId: command.handId, turnId: command.turnId, move: command.move, raiseTo: command.raiseTo } : { action: command.action, requestId: command.requestId, tableId: command.tableId, escrowId: command.escrowId };
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  const cached = this.receipts.get(key);
  if (cached) { if (cached.fingerprint !== fingerprint) fail('request_conflict', 'This request was used for another poker action'); return cached.receipt; }
  if (this.pending?.requestKey === key) {
   if (this.pending.fingerprint !== fingerprint) fail('request_conflict', 'This request was used for another poker action');
   if (!await this.retry()) fail('temporarily_unavailable', 'Poker is saving; retry the same request');
   return this.receipts.get(key)!.receipt;
  }
  if (command.action === 'poker-join') {
   const prior = await this.repository.replay(profileId, command.requestId, fingerprint);
   if (prior) return this.remember(key, fingerprint, { requestId: command.requestId, ok: true, message: prior.escrow.status === 'closed' ? 'This buy-in has already been cashed out' : 'Buy-in already accepted', wallet: prior.wallet });
  }
  if (this.pending) fail('table_saving', 'Poker is saving; please wait');
  if (!originSession || this.hooks.actor(profileId)?.sessionId !== originSession) fail('session_ended', 'This poker session has ended');
  const accepted = (extra: Partial<CasinoReceipt> = {}) => this.remember(key, fingerprint, { requestId: command.requestId, ok: true, message: 'Accepted', ...extra });
  if (command.action === 'poker-join') {
   if (!Number.isInteger(command.seat) || command.seat < 0 || command.seat > 5 || !Number.isSafeInteger(command.buyIn) || command.buyIn < POKER_MIN_BUY_IN || command.buyIn > POKER_MAX_BUY_IN || command.buyIn % POKER_BUY_IN_STEP) fail('invalid_buy_in', 'Choose a seat and 100–1,000 credits in steps of 100');
   const validate = () => { this.hooks.canJoin(profileId, originSession!); if (!['waiting', 'result'].includes(this.view.phase)) fail('hand_in_progress', 'Join between poker hands'); if (this.own(profileId)) fail('already_seated', 'Rejoin your existing poker seat'); if (this.seats.has(command.seat)) fail('seat_taken', 'That poker seat is occupied'); };
   validate(); const name = this.hooks.actor(profileId)!.name;
   const input = { profileId, requestId: command.requestId, fingerprint, roomId: this.roomId, tableId: 'poker-1' as const, seat: command.seat, amount: command.buyIn };
   this.pending = { requestKey: key, fingerprint, run: async () => {
    const result = await this.repository.buyIn(input, validate);
    this.seats.set(command.seat, { escrow: { ...result.escrow }, sessionId: originSession!, name, leaving: false, disconnected: this.hooks.actor(profileId)?.sessionId !== originSession, cards: [], stack: result.escrow.stack, bet: 0, committed: 0, state: 'waiting', actedAt: null, needsAction: false });
    if (this.view.phase === 'waiting' && !this.view.deadline && [...this.seats.values()].filter(s => s.stack > 0 && !s.leaving && this.connected(s)).length >= 2) this.view.deadline = this.now() + POKER_BREAK_MS;
    this.hooks.wallet(profileId, result.wallet); accepted({ wallet: result.wallet, message: 'Poker buy-in accepted' });
   } };
   if (!await this.retry()) fail('temporarily_unavailable', 'Poker is saving; retry the same buy-in');
   return this.receipts.get(key)!.receipt;
  }
  const s = this.own(profileId);
  if (!s) fail('not_seated', 'Join a poker seat first');
  if (command.action === 'poker-rejoin') {
   if (s!.escrow.id !== command.escrowId || s!.leaving) fail('invalid_escrow', 'That poker seat is no longer available');
   this.hooks.canJoin(profileId, originSession!); s!.sessionId = originSession!; s!.disconnected = false; s!.name = this.hooks.actor(profileId)!.name;
   return accepted({ message: 'Poker seat rejoined' });
  }
  if (command.action === 'poker-leave') {
   if (s!.escrow.id !== command.escrowId) fail('invalid_escrow', 'That poker seat is no longer active');
   // Leaving does not require proximity and never withdraws money committed to a live hand.
   s!.leaving = true;
   if (!s!.cards.length || this.view.phase === 'result' || this.view.phase === 'waiting') {
    this.pending = { requestKey: key, fingerprint, run: async () => { await this.cashOut(s!); accepted({ message: 'Poker stack cashed out' }); } };
    if (!await this.retry()) fail('temporarily_unavailable', 'Poker cash-out is saving');
    return this.receipts.get(key)!.receipt;
   }
   if (['preflop', 'flop', 'turn', 'river'].includes(this.view.phase)) await this.progress(s!.escrow.seat, true);
   return accepted({ message: 'Leaving after this hand settles' });
  }
  this.hooks.eligible(profileId, originSession!);
  if (s!.sessionId !== originSession || s!.disconnected || command.handId !== this.view.handId || command.turnId !== this.turnId || this.view.activeSeat !== s!.escrow.seat || this.now() >= this.view.deadline) fail('not_your_turn', 'This poker turn is no longer waiting');
  const legal = this.legal(s!); if (!legal) fail('not_your_turn', 'This poker turn is no longer waiting');
  const due = this.view.currentBet - s!.bet;
  switch (command.move) {
   case 'fold': s!.state = 'folded'; break;
   case 'check': if (!legal!.canCheck) fail('invalid_action', 'Call or fold to a bet'); break;
   case 'call': if (!legal!.canCall) fail('invalid_action', 'There is no bet to call'); this.commit(s!, Math.min(s!.stack, due)); break;
   case 'raise': {
    if (!legal!.canRaise || !Number.isSafeInteger(command.raiseTo) || command.raiseTo! < legal!.minRaiseTo || command.raiseTo! > legal!.maxRaiseTo) fail('invalid_raise', 'Choose a full legal raise');
    this.raise(s!, command.raiseTo!); break;
   }
   case 'all-in': if (!legal!.canAllIn) fail('invalid_raise', 'Raising has not reopened'); if (s!.bet + s!.stack > this.view.currentBet) this.raise(s!, s!.bet + s!.stack); else this.commit(s!, s!.stack); break;
   default: fail('invalid_action', 'Unknown poker action');
  }
  s!.actedAt = this.view.currentBet; s!.needsAction = false;
  // Remember action before any settlement await; a failed save cannot replay the action.
  const receipt = accepted(); await this.progress(s!.escrow.seat); return receipt;
 }
 private commit(s: Seat, amount: number) { s.stack -= amount; s.bet += amount; s.committed += amount; this.view.pot += amount; if (!s.stack) s.state = 'all-in'; }
 private raise(s: Seat, target: number) {
  const increase = target - this.view.currentBet;
  this.commit(s, target - s.bet); this.view.currentBet = target;
  if (increase >= this.minRaise) this.minRaise = increase;
  for (const other of this.seats.values()) if (other !== s && other.state === 'playing' && other.bet < target) other.needsAction = true;
 }
 private clockwise(after: number, candidates: number[]) { return [...candidates].sort((a, b) => (a - after + 5) % 6 - (b - after + 5) % 6); }
 private participants() { return [...this.seats.values()].filter(s => s.cards.length); }
 private async begin() {
  const players = [...this.seats.values()].filter(s => s.stack > 0 && !s.leaving && this.connected(s));
  if (players.length < 2) { this.view.phase = 'waiting'; this.view.deadline = 0; return; }
  const button = this.view.button === null ? Math.min(...players.map(s => s.escrow.seat)) : this.clockwise(this.view.button, players.map(s => s.escrow.seat))[0];
  const ordered = this.clockwise(button, players.map(s => s.escrow.seat));
  const sb = players.length === 2 ? button : ordered[0], bb = players.length === 2 ? ordered[0] : ordered[1];
  const handId = randomUUID(), roster = players.map(s => ({ ...s.escrow }));
  this.pending = { run: async () => {
   await this.repository.beginHand({ handId, roomId: this.roomId, tableId: 'poker-1', roster });
   this.cards = this.deck(); if (this.cards.length !== 52 || new Set(this.cards.map(c => `${c.rank}:${c.suit}`)).size !== 52) throw new Error('Poker requires a complete fresh deck');
   this.view = { ...this.view, roundId: handId, handId, phase: 'preflop', button, smallBlindSeat: sb, bigBlindSeat: bb, activeSeat: null, board: [], pot: 0, currentBet: POKER_BIG_BLIND, pots: [], winners: [], message: 'Preflop' };
   this.minRaise = POKER_BIG_BLIND; this.showdown = false;
   for (const s of players) { s.cards = []; s.bet = 0; s.committed = 0; s.state = 'playing'; s.actedAt = null; s.needsAction = true; s.escrow.activeHandId = handId; }
   for (let card = 0; card < 2; card++) for (const seat of ordered) this.seats.get(seat)!.cards.push(this.draw());
   this.commit(this.seats.get(sb)!, Math.min(POKER_SMALL_BLIND, this.seats.get(sb)!.stack));
   this.commit(this.seats.get(bb)!, Math.min(POKER_BIG_BLIND, this.seats.get(bb)!.stack));
  } };
  if (await this.retry()) await this.progress(bb);
 }
 private draw() { const card = this.cards.shift(); if (!card) throw new Error('Poker deck exhausted'); return card; }
 private nextStreet() {
  this.draw(); // Burn a card before each community street.
  const count = this.view.board.length === 0 ? 3 : 1; for (let i = 0; i < count; i++) this.view.board.push(this.draw());
  this.view.currentBet = 0; this.minRaise = POKER_BIG_BLIND;
  for (const s of this.participants()) { s.bet = 0; s.actedAt = null; s.needsAction = s.state === 'playing'; }
  this.view.phase = this.view.board.length === 3 ? 'flop' : this.view.board.length === 4 ? 'turn' : 'river'; this.view.message = this.view.phase;
 }
 private async progress(after: number, preserveTurn = false) {
  const live = this.participants().filter(s => s.state !== 'folded');
  if (live.length <= 1) { await this.finish(false); return; }
  const actionable = live.filter(s => s.state === 'playing');
  const waiting = actionable.filter(s => s.needsAction || s.bet < this.view.currentBet);
  const liveBet = Math.max(...live.map(s => s.bet));
  if (waiting.length && !(actionable.length === 1 && actionable[0].bet >= liveBet)) {
   const current = preserveTurn ? waiting.find(s => s.escrow.seat === this.view.activeSeat) : undefined;
   if (current && !current.leaving) return;
   const next = current?.escrow.seat ?? this.clockwise(after, waiting.map(s => s.escrow.seat))[0];
   const player = this.seats.get(next)!;
   // Defer explicit departure folds to turn order. A completed betting round/runout above keeps its pot eligibility.
   if (player.leaving) { player.state = 'folded'; player.needsAction = false; await this.progress(next); return; }
   this.view.activeSeat = next; this.turnId = randomUUID(); this.view.deadline = this.now() + POKER_TURN_MS; return;
  }
  this.view.activeSeat = null; this.turnId = '';
  if (this.view.board.length === 5) { await this.finish(true); return; }
  if (actionable.length < 2) { this.view.phase = 'runout'; this.view.deadline = this.now() + POKER_RUNOUT_MS; this.view.message = 'All-in runout'; return; }
  this.nextStreet(); await this.progress(this.view.button!);
 }
 private async finish(showdown: boolean) {
  const participants = this.participants();
  const result = pokerPots(participants.map(s => ({ seat: s.escrow.seat, committed: s.committed, folded: s.state === 'folded', cards: [...s.cards] })), [...this.view.board], this.view.button!);
  const allocations = participants.map(s => ({ escrowId: s.escrow.id, stack: s.stack + (result.returns.get(s.escrow.seat) ?? 0) }));
  const contributions = new Map(participants.map(s => {
   const refund = result.refunds.get(s.escrow.seat) ?? 0;
   return [s.escrow.id, { committed: s.committed - refund, bet: Math.max(0, s.bet - refund) }];
  }));
  const handId = this.view.handId!;
  this.view.activeSeat = null; this.turnId = '';
  this.pending = { run: async () => {
   const escrows = await this.repository.finishHand(handId, allocations);
   for (const s of participants) { const saved = escrows.find(e => e.id === s.escrow.id); if (!saved) throw new Error('Missing settled poker escrow'); s.escrow = { ...saved }; s.stack = saved.stack; Object.assign(s, contributions.get(s.escrow.id)!); }
   this.view.pot = result.pots.reduce((sum, pot) => sum + pot.amount, 0);
   this.view.pots = result.pots; this.view.winners = result.winners; this.showdown = showdown;
   this.view.phase = 'result'; this.view.deadline = this.now() + POKER_BREAK_MS; this.view.message = showdown ? 'Showdown' : 'Hand won without showdown';
  } };
  await this.retry();
 }
 private async cashOut(s: Seat) { const result = await this.repository.cashOut(s.escrow.id); this.hooks.wallet(s.escrow.profileId, result.wallet); if (this.seats.get(s.escrow.seat)?.escrow.id === s.escrow.id) this.seats.delete(s.escrow.seat); }
 leave(profileId: string) { const s = this.own(profileId); if (s) s.disconnected = true; }
 async tick() {
  if (this.pending) { if (!await this.retry()) return; }
  if (this.view.phase === 'result' && this.now() >= this.view.deadline) {
   for (const s of [...this.seats.values()]) if (s.leaving || !s.stack || !this.connected(s)) {
    this.pending = { run: () => this.cashOut(s) }; if (!await this.retry()) return;
   }
   for (const s of this.seats.values()) { s.cards = []; s.bet = 0; s.committed = 0; s.state = 'waiting'; }
   this.view.phase = 'waiting'; this.view.handId = null; this.view.board = []; this.view.pot = 0; this.view.currentBet = 0; this.view.pots = []; this.view.winners = []; this.showdown = false;
  }
  if (this.view.phase === 'waiting') {
   for (const s of [...this.seats.values()]) if (s.leaving || !s.stack || !this.connected(s)) { this.pending = { run: () => this.cashOut(s) }; if (!await this.retry()) return; }
   const funded = [...this.seats.values()].filter(s => s.stack > 0 && !s.leaving && this.connected(s));
   if (funded.length < 2) { this.view.deadline = 0; return; }
   if (!this.view.deadline) this.view.deadline = this.now() + POKER_BREAK_MS;
   if (this.now() >= this.view.deadline) await this.begin();
   return;
  }
  if (this.view.phase === 'runout' && this.now() >= this.view.deadline) { this.nextStreet(); await this.progress(this.view.button!); return; }
  if (this.view.activeSeat !== null && this.now() >= this.view.deadline) {
   const s = this.seats.get(this.view.activeSeat)!;
   if (s.bet < this.view.currentBet) s.state = 'folded';
   s.needsAction = false; s.actedAt = this.view.currentBet; await this.progress(s.escrow.seat);
  } else if (this.view.phase === 'preflop' && this.view.activeSeat === null) await this.progress(this.view.bigBlindSeat!);
 }
}
