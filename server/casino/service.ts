import { PokerService } from './poker.ts';
import type { PokerCommand } from '../../shared/poker.ts';
import { resolveCraps, crapsReturn, CRAPS_BETTING_MS, CRAPS_AWAITING_ROLL_MS, type CrapsView, type CrapsBet, type CrapsResult } from '../../shared/craps.ts';
import { CRAPS_ROLL_LEAD_MS, CRAPS_ROLL_MS } from '../../shared/crapsMotion.ts';
import { createHash, randomUUID } from 'node:crypto';
import { CASINO_ANCHORS, CASINO_INTERACTION_RADIUS, ROULETTE_BETTING_MS, ROULETTE_SPIN_MS, CASINO_RESULT_MS, BLACKJACK_BETTING_MS, BLACKJACK_ACTION_MS, SLOTS_SPIN_MS, type CasinoTableId, type CasinoCommand, type CasinoState, type CasinoReceipt, type CasinoTableView, type RouletteView, type RouletteBet, type BlackjackView, type BlackjackHandView, type CasinoOccupant, type SlotsView, type Card, type SlotSymbol } from '../../shared/casino.ts';
import { inCasino } from '../../shared/casinoLayout.ts';
import { startRouletteMotion, ROULETTE_LANDING_LEAD_MS, ROULETTE_LANDING_MS } from '../../shared/rouletteMotion.ts';
import type { WalletState } from '../../shared/catalog.ts';
import { EconomyError } from '../persistence/economy.ts';
import { CasinoRepository, type WagerInput, type WagerResult } from '../persistence/casino.ts';
import { cryptoRandom, validStake, rouletteBet, rouletteReturn, shoe, natural, total, blackjackReturn, slotReels, slotsReturn, type Random } from './rules.ts';

export type CasinoHooks = {
 actor(profileId: string): { sessionId: string; name: string; x: number; z: number } | undefined;
 publish(state: CasinoState): void;
 private(profileId: string, message: string, payload: unknown): void;
 wallet(profileId: string, wallet: WalletState): void;
};
type Occupant = CasinoOccupant & { sessionId: string; departed: boolean };
type Hand = { cards: Card[]; stake: number; wagers: string[]; split: boolean; state: BlackjackHandView['state']; outcome?: BlackjackHandView['outcome']; returned?: number };
type Seat = { player: Occupant; hands: Hand[] };
type Roulette = { view: RouletteView; bets: { wagerId: string; profileId: string; bet: RouletteBet }[]; outcome: number | null };
type Blackjack = { view: BlackjackView; seats: Map<number, Seat>; cards: Card[]; dealer: Card[]; revealed: boolean };
type Slots = { view: SlotsView; player: Occupant | null; outcome: SlotSymbol[]; wagerId: string | null; payout: number };
type Pending = { depart: () => void; retryAt: number; profileId: string; command: CasinoCommand; fingerprint: string; tableId: CasinoTableId; run: () => Promise<void> };
const fail = (code: string, message: string): never => { throw new EconomyError(code, message); };

/** One queue serialises admission and deadline transitions, including all database awaits. */
export class CasinoService {
 private poker?: PokerService;
 private pokerRecipients = new Set<string>();
 private craps!: { view: CrapsView; bets: { wagerId: string; profileId: string; bet: CrapsBet; player: Occupant }[]; shooter: Occupant | null; throwingShooter: Occupant | null; outcome: CrapsResult | null };
 private roulette = new Map<CasinoTableId, Roulette>();
 private blackjack = new Map<CasinoTableId, Blackjack>();
 private slots = new Map<CasinoTableId, Slots>();
 private queue: Promise<void> = Promise.resolve();
 private timer?: ReturnType<typeof setInterval>;
 private closed = false;
 private ticking = false;
 private pending = new Map<string, Pending>();
 private receipts = new Map<string, { fingerprint: string; receipt: CasinoReceipt; roundId?: string }>();
 private random: Random;
 private now: () => number;
 constructor(readonly roomId: string, readonly repository: CasinoRepository, private hooks: CasinoHooks, options: { random?: Random; now?: () => number; shoe?: () => Card[] } = {}) {
  this.random = options.random ?? cryptoRandom; this.now = options.now ?? Date.now; this.makeShoe = options.shoe ?? (() => shoe(this.random));
  if (repository.poker) this.poker = new PokerService(roomId, repository.poker, { actor: id => hooks.actor(id), eligible: (id, session) => this.eligible(id, 'poker-1', session), canJoin: (id, session) => { this.eligible(id, 'poker-1', session); this.unoccupied(id, 'poker-1'); }, wallet: (id, wallet) => hooks.wallet(id, wallet) }, { now: this.now, random: this.random });
  const now = this.now();
  this.craps = { view: { id: 'craps-1', game: 'craps', roundId: randomUUID(), rollId: randomUUID(), phase: 'betting', deadline: now + CRAPS_BETTING_MS, point: null, shooter: null, betCount: 0, result: null, history: [], motion: null }, bets: [], shooter: null, throwingShooter: null, outcome: null };
  for (const anchor of CASINO_ANCHORS.filter(a => a.game === 'roulette')) this.roulette.set(anchor.id, { view: { id: anchor.id as RouletteView['id'], game: 'roulette', roundId: randomUUID(), phase: 'betting', deadline: now + ROULETTE_BETTING_MS, result: null, betCount: 0, history: [], motion: null }, bets: [], outcome: null });
  for (const anchor of CASINO_ANCHORS.filter(a => a.game === 'blackjack')) this.blackjack.set(anchor.id, { view: { id: anchor.id as BlackjackView['id'], game: 'blackjack', roundId: randomUUID(), phase: 'betting', deadline: now + BLACKJACK_BETTING_MS, dealer: [], dealerTotal: null, seats: [], activeSeat: null, activeHand: null }, seats: new Map(), cards: [], dealer: [], revealed: false });
  for (const anchor of CASINO_ANCHORS.filter(a => a.game === 'slots')) this.slots.set(anchor.id, { view: { id: anchor.id, game: 'slots', roundId: randomUUID(), phase: 'idle', deadline: 0, player: null, reels: [], stake: 0, returned: null }, player: null, outcome: [], wagerId: null, payout: 0 });
 }
 private makeShoe: () => Card[];
 start() { if (!this.timer && !this.closed) { this.timer = setInterval(() => { if (!this.ticking) { this.ticking = true; void this.tick().catch(() => {}).finally(() => { this.ticking = false; }); } }, 250); this.timer.unref(); this.publish(); } }
 private enqueue(work: () => Promise<void>) { const next = this.queue.then(work); this.queue = next.catch(() => {}); return next; }
 private key(profileId: string, requestId: string) { return `${profileId}:${requestId}`; }
 private blocked(id: CasinoTableId) { return [...this.pending.values()].some(p => p.tableId === id); }
 private near(profileId: string, id: CasinoTableId) {
  const actor = this.hooks.actor(profileId), anchor = CASINO_ANCHORS.find(a => a.id === id);
  // Blackjack interaction belongs to the south side of the table; standing behind the dealer never qualifies.
  const behind = !!actor && !!anchor && anchor.game === 'blackjack' && actor.z > anchor.z + .8;
  return !!actor && !!anchor && !behind && inCasino(actor.x, actor.z) && Math.hypot(actor.x - anchor.x, actor.z - anchor.z) <= CASINO_INTERACTION_RADIUS;
 }
 private eligible(profileId: string, id: CasinoTableId, sessionId: string) {
  if (this.closed || this.hooks.actor(profileId)?.sessionId !== sessionId) fail('session_ended', 'This game session has ended');
  if (!this.near(profileId, id)) fail('too_far', 'Move closer to this casino table');
 }
 private occupant(profileId: string): Occupant {
  const actor = this.hooks.actor(profileId)!;
  return { profileId, name: actor.name, sessionId: actor.sessionId, connected: true, departed: false };
 }
 private connected(p: Occupant, id: CasinoTableId) { return !p.departed && this.hooks.actor(p.profileId)?.sessionId === p.sessionId && this.near(p.profileId, id); }
 private publicPlayer(p: Occupant, id: CasinoTableId): CasinoOccupant { return { profileId: p.profileId, name: p.name, connected: this.connected(p, id) }; }
 private actions(table: Blackjack, index: number, handIndex: number): BlackjackHandView['actions'] {
  const seat = table.seats.get(index), hand = seat?.hands[handIndex];
  if (!seat || !hand || this.blocked(table.view.id) || table.view.phase !== 'playing' || table.view.activeSeat !== index || table.view.activeHand !== handIndex || hand.state !== 'playing' || !this.connected(seat.player, table.view.id)) return [];
  const actions: BlackjackHandView['actions'] = ['hit', 'stand'];
  if (hand.cards.length === 2) actions.push('double');
  if (hand.cards.length === 2 && seat.hands.length === 1 && hand.cards[0].rank === hand.cards[1].rank) actions.push('split');
  return actions;
 }
 private state(): CasinoState {
  const tables: CasinoTableView[] = [...this.roulette.values()].map(r => ({ ...r.view, motion: r.view.motion ? { ...r.view.motion } : null, history: [...r.view.history], phase: this.blocked(r.view.id) ? 'paused' : r.view.phase, betCount: r.bets.length }));
  for (const t of this.blackjack.values()) {
   tables.push({ ...t.view, phase: this.blocked(t.view.id) ? 'paused' : t.view.phase, dealer: t.revealed ? t.dealer.map(c => ({ ...c })) : t.dealer.length ? [{ ...t.dealer[0] }, null] : [], dealerTotal: t.revealed ? total(t.dealer).total : null,
    seats: [...t.seats.entries()].sort(([a], [b]) => a - b).map(([index, s]) => ({ seat: index, player: this.publicPlayer(s.player, t.view.id), hands: s.hands.map((h, hi) => ({ cards: h.cards.map(c => ({ ...c })), stake: h.stake, ...total(h.cards), state: h.state, ...(h.outcome ? { outcome: h.outcome, returned: h.returned } : {}), actions: this.actions(t, index, hi) })) })) });
  }
  for (const t of this.slots.values()) tables.push({ ...t.view, phase: this.blocked(t.view.id) ? 'paused' : t.view.phase, player: t.player ? this.publicPlayer(t.player, t.view.id) : null, reels: [...t.view.reels] });
  const c = this.craps;
  tables.push(structuredClone({ ...c.view, phase: this.blocked('craps-1') ? 'paused' : c.view.phase, betCount: c.bets.length, shooter: c.shooter ? this.publicPlayer(c.shooter, 'craps-1') : null }));
  if (this.poker) tables.push(this.poker.state());
  return { serverTime: this.now(), tables };
 }
 private publish() {
  this.hooks.publish(this.state());
  const current = new Set(this.poker?.profiles() ?? []);
  for (const id of new Set([...current, ...this.pokerRecipients])) this.privateState(id);
  this.pokerRecipients = current;
 }
 private privateState(profileId: string) { this.hooks.private(profileId, 'casino-private', { poker: this.poker?.privateState(profileId) ?? null, crapsBets: this.craps.bets.filter(b => b.profileId === profileId).map(b => ({ tableId: 'craps-1', wagerId: b.wagerId, roundId: this.craps.view.roundId, bet: { ...b.bet } })), rouletteBets: [...this.roulette.values()].flatMap(r => r.bets.filter(b => b.profileId === profileId).map(b => ({ tableId: r.view.id, wagerId: b.wagerId, roundId: r.view.roundId, bet: b.bet }))) }); }
 private receipt(profileId: string, command: CasinoCommand, fingerprint: string, receipt: CasinoReceipt, remember = true) {
  if (remember) {
   this.receipts.set(this.key(profileId, command.requestId), { fingerprint, receipt, roundId: command.action === 'blackjack-action' ? command.roundId : undefined });
   if (this.receipts.size > 4096) {
    const expired = [...this.receipts].find(([, value]) => !value.roundId || ![...this.blackjack.values()].some(t => t.view.roundId === value.roundId));
    if (expired) this.receipts.delete(expired[0]);
   }
  }
  if (receipt.wallet) this.hooks.wallet(profileId, receipt.wallet);
  this.hooks.private(profileId, 'casino-receipt', receipt);
 }
 private ok(profileId: string, command: CasinoCommand, fingerprint: string, extra: Partial<CasinoReceipt> = {}) { this.receipt(profileId, command, fingerprint, { requestId: command.requestId, ok: true, message: 'Accepted', ...extra }); }
 private rejected(profileId: string, command: CasinoCommand, fingerprint: string, error: unknown, remember = false) {
  const known = error instanceof EconomyError;
  this.receipt(profileId, command, fingerprint, { requestId: command.requestId, ok: false, code: known ? error.code : 'temporarily_unavailable', message: known ? error.message : 'The casino is saving. Please retry this same action shortly.', ...(known && error.snapshot ? { wallet: error.snapshot } : {}) }, remember);
 }
 private parse(value: unknown): CasinoCommand {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 4096) fail('invalid_command', 'Invalid casino command');
  const v = value as Record<string, unknown>;
  if (typeof v.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(v.requestId)) fail('invalid_request', 'Invalid casino request ID');
  const requestId = v.requestId as string;
  if (v.action === 'sync') return { action: 'sync', requestId };
  if (typeof v.tableId !== 'string' || !CASINO_ANCHORS.some(a => a.id === v.tableId)) fail('invalid_table', 'Unknown casino table');
  const tableId = v.tableId as CasinoTableId;
  if (typeof v.action === 'string' && v.action.startsWith('poker-')) {
   if (tableId !== 'poker-1') fail('invalid_table', 'Choose the poker table');
   if (v.action === 'poker-join') {
    if (!Number.isInteger(v.seat) || Number(v.seat) < 0 || Number(v.seat) > 5 || !Number.isSafeInteger(v.buyIn) || Number(v.buyIn) < 200 || Number(v.buyIn) > 1000 || Number(v.buyIn) % 100) fail('invalid_buy_in', 'Choose a seat and 200–1,000 credits in steps of 100');
    return { action: 'poker-join', tableId: 'poker-1', requestId, seat: v.seat as number, buyIn: v.buyIn as number };
   }
   if (v.action === 'poker-rejoin' || v.action === 'poker-leave') {
    if (typeof v.escrowId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.escrowId)) fail('invalid_seat', 'Invalid poker seat');
    return { action: v.action, tableId: 'poker-1', requestId, escrowId: v.escrowId as string };
   }
   if (v.action === 'poker-action') {
    if (typeof v.handId !== 'string' || v.handId.length > 100 || typeof v.turnId !== 'string' || v.turnId.length > 100 || !['fold', 'check', 'call', 'raise', 'all-in'].includes(String(v.move)) || (v.raiseTo !== undefined && (!Number.isSafeInteger(v.raiseTo) || Number(v.raiseTo) < 0))) fail('invalid_action', 'Invalid poker action');
    return { action: 'poker-action', tableId: 'poker-1', requestId, handId: v.handId as string, turnId: v.turnId as string, move: v.move as Extract<PokerCommand, { action: 'poker-action' }>['move'], ...(v.raiseTo !== undefined ? { raiseTo: v.raiseTo as number } : {}) };
   }
   fail('invalid_action', 'Unknown poker action');
  }
  if (v.action === 'leave') return { action: 'leave', requestId, tableId };
  if (v.action === 'slots-spin') { if (!this.slots.has(tableId) || !validStake(v.stake)) fail('invalid_stake', 'Choose a slot machine and 10–100 credits in steps of 10'); return { action: 'slots-spin', requestId, tableId, stake: v.stake as number }; }
  if (v.action === 'blackjack-join') { if (!this.blackjack.has(tableId) || !Number.isInteger(v.seat) || Number(v.seat) < 0 || Number(v.seat) > 4) fail('invalid_seat', 'Choose an available blackjack seat'); return { action: 'blackjack-join', requestId, tableId: tableId as BlackjackView['id'], seat: v.seat as number }; }
  if (typeof v.roundId !== 'string' || v.roundId.length > 100) fail('invalid_round', 'Invalid casino round');
  const roundId = v.roundId as string;
  if (v.action === 'craps-bet') { const b = v.bet as CrapsBet | undefined; if (tableId !== 'craps-1' || !b || !['pass', 'dont-pass'].includes(b.kind) || !validStake(b.stake)) fail('invalid_bet', 'Choose Pass or Don’t Pass and 10–100 credits in steps of 10'); return { action: 'craps-bet', requestId, tableId: 'craps-1', roundId, bet: { kind: b!.kind, stake: b!.stake } }; }
  if (v.action === 'craps-roll') { if (tableId !== 'craps-1' || typeof v.rollId !== 'string' || v.rollId.length > 100) fail('invalid_roll', 'Invalid dice roll'); return { action: 'craps-roll', requestId, tableId: 'craps-1', roundId, rollId: v.rollId as string }; }
  if (v.action === 'roulette-bet') { if (!this.roulette.has(tableId)) fail('invalid_table', 'Choose the roulette table'); return { action: 'roulette-bet', requestId, tableId: tableId as RouletteView['id'], roundId, bet: rouletteBet(v.bet) }; }
  if (v.action === 'blackjack-bet') { if (!this.blackjack.has(tableId) || !validStake(v.stake)) fail('invalid_stake', 'Choose 10–100 credits in steps of 10'); return { action: 'blackjack-bet', requestId, tableId: tableId as BlackjackView['id'], roundId, stake: v.stake as number }; }
  if (v.action === 'blackjack-action') { if (!this.blackjack.has(tableId) || !Number.isInteger(v.hand) || Number(v.hand) < 0 || Number(v.hand) > 1 || !['hit', 'stand', 'double', 'split'].includes(String(v.move))) fail('invalid_action', 'Invalid blackjack action'); return { action: 'blackjack-action', requestId, tableId: tableId as BlackjackView['id'], roundId, hand: v.hand as number, move: v.move as 'hit' | 'stand' | 'double' | 'split' }; }
  return fail('invalid_action', 'Unknown casino action');
 }
 async handle(profileId: string, value: unknown) {
  const originSession = this.hooks.actor(profileId)?.sessionId;
  let command: CasinoCommand;
  try { command = this.parse(value); } catch (error) { this.hooks.private(profileId, 'casino-receipt', { requestId: typeof (value as any)?.requestId === 'string' ? (value as any).requestId.slice(0, 100) : '', ok: false, code: error instanceof EconomyError ? error.code : 'invalid_command', message: error instanceof EconomyError ? error.message : 'Invalid casino command' }); return; }
  const fingerprint = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  return this.enqueue(async () => {
   if (this.closed) { this.rejected(profileId, command, fingerprint, new EconomyError('casino_closed', 'This casino room has closed')); return; }
   if (command.action === 'sync') { this.publish(); this.privateState(profileId); this.receipt(profileId, command, fingerprint, { requestId: command.requestId, ok: true, message: 'Synchronized' }, false); return; }
   const key = this.key(profileId, command.requestId), cached = this.receipts.get(key);
   if (cached) { if (cached.fingerprint !== fingerprint) this.rejected(profileId, command, fingerprint, new EconomyError('request_conflict', 'This request was used for another action')); else this.receipt(profileId, command, fingerprint, cached.receipt); return; }
   if (command.action === 'poker-join' || command.action === 'poker-rejoin' || command.action === 'poker-action' || command.action === 'poker-leave' || (command.action === 'leave' && command.tableId === 'poker-1')) {
    try {
     if (!this.poker) fail('table_unavailable', 'The poker table is unavailable');
     const own = this.poker!.privateState(profileId);
     const pokerCommand: PokerCommand = command.action === 'leave' ? { action: 'poker-leave', tableId: 'poker-1', requestId: command.requestId, escrowId: own?.escrowId ?? '' } : command;
     const receipt = await this.poker!.handle(profileId, pokerCommand, originSession);
     this.receipt(profileId, command, fingerprint, receipt);
    } catch (error) { this.rejected(profileId, command, fingerprint, error); }
    this.publish(); this.privateState(profileId); return;
   }
   const pending = this.pending.get(key);
   if (pending) { if (pending.fingerprint !== fingerprint) this.rejected(profileId, command, fingerprint, new EconomyError('request_conflict', 'This request was used for another action')); else await this.attempt(key, pending); return; }
   try {
    // Durable replay precedes current location, occupancy, phase and deadline checks.
    const prior = await this.repository.replay(profileId, command.requestId, fingerprint);
    if (prior) { this.ok(profileId, command, fingerprint, { wallet: prior.wallet, wagerId: prior.wager.id, roundId: prior.wager.roundId, message: prior.wager.status === 'refunded' ? 'This wager was refunded after a restart' : 'Wager already accepted' }); return; }
    const actor = this.hooks.actor(profileId);
    if (!actor || !originSession || actor.sessionId !== originSession) fail('session_ended', 'This game session has ended');
    if (command.action === 'leave') { this.depart(profileId, command.tableId); this.ok(profileId, command, fingerprint); this.publish(); return; }
    if (this.blocked(command.tableId)) fail('table_saving', 'This table is saving. Please wait.');
    this.eligible(profileId, command.tableId, originSession!);
    if (command.action === 'craps-roll') {
     const t = this.craps; this.chooseCrapsShooter();
     if (t.view.phase !== 'awaiting-roll' || t.view.roundId !== command.roundId || t.view.rollId !== command.rollId || this.now() >= t.view.deadline) fail('invalid_roll', 'This throw is no longer waiting');
     if (t.shooter?.profileId !== profileId || !this.connected(t.shooter, 'craps-1')) fail('not_shooter', 'Wait for the shooter to roll');
     await this.rollCraps(); this.ok(profileId, command, fingerprint); this.publish(); return;
    }
    if (command.action === 'blackjack-join') { this.join(profileId, command.tableId, command.seat); this.ok(profileId, command, fingerprint); this.publish(); return; }
    if (command.action === 'blackjack-action' && (command.move === 'hit' || command.move === 'stand')) {
     const { table, hand } = this.turn(profileId, command, originSession!);
     if (command.move === 'hit') { hand.cards.push(this.draw(table)); if (total(hand.cards).total >= 21) hand.state = total(hand.cards).total > 21 ? 'bust' : 'stood'; } else hand.state = 'stood';
     this.next(table); this.ok(profileId, command, fingerprint); this.publish(); return;
    }
    const operation = this.financial(profileId, command, fingerprint, originSession!);
    this.pending.set(key, operation); await this.attempt(key, operation);
   } catch (error) { this.rejected(profileId, command, fingerprint, error); }
  });
 }
 private async attempt(key: string, operation: Pending, notifyError = true) {
  try { await operation.run(); this.pending.delete(key); this.privateState(operation.profileId); this.publish(); }
  catch (error) { if (error instanceof EconomyError) this.pending.delete(key); else operation.retryAt = this.now() + 1000; if (notifyError || error instanceof EconomyError) this.rejected(operation.profileId, operation.command, operation.fingerprint, error); this.publish(); }
 }
 private financial(profileId: string, command: CasinoCommand, fingerprint: string, sessionId: string): Pending {
  if (command.action === 'sync' || command.action === 'leave' || command.action === 'blackjack-join' || command.action === 'craps-roll' || command.action === 'poker-join' || command.action === 'poker-action' || command.action === 'poker-leave' || command.action === 'poker-rejoin') return fail('invalid_action', 'Invalid financial action');
  let departed = false;
  let stake: number, roundId: string, details: Record<string, unknown>, validate: () => void, apply: (result: WagerResult) => void;
  if (command.action === 'craps-bet') {
   const table = this.craps, player = this.occupant(profileId); stake = command.bet.stake; roundId = command.roundId; details = { game: 'craps', bet: command.bet };
   validate = () => { this.eligible(profileId, 'craps-1', sessionId); if (table.view.roundId !== roundId || table.view.phase !== 'betting' || table.view.point !== null || this.now() >= table.view.deadline) fail('betting_closed', 'Craps betting has closed'); if (table.bets.some(b => b.profileId === profileId)) fail('already_bet', 'One line bet per cycle'); };
   apply = result => { player.departed = departed; table.bets.push({ wagerId: result.wager.id, profileId, bet: command.bet, player }); this.chooseCrapsShooter(); };
  } else if (command.action === 'roulette-bet') {
   const table = this.roulette.get(command.tableId)!; stake = command.bet.stake; roundId = command.roundId; details = { game: 'roulette', bet: command.bet };
   validate = () => {
    this.eligible(profileId, command.tableId, sessionId);
    if (table.view.roundId !== roundId || table.view.phase !== 'betting' || this.now() >= table.view.deadline) fail('betting_closed', 'Roulette betting has closed');
    const mine = table.bets.filter(b => b.profileId === profileId);
    if (mine.length >= 20 || mine.reduce((s, b) => s + b.bet.stake, 0) + stake > 1000) fail('round_limit', 'This round allows 20 bets and 1,000 credits per person');
   };
   apply = result => { table.bets.push({ wagerId: result.wager.id, profileId, bet: command.bet }); };
  } else if (command.action === 'slots-spin') {
   const table = this.slots.get(command.tableId)!, occupant = this.occupant(profileId); stake = command.stake; roundId = randomUUID();
   const reels = slotReels(this.random), payout = slotsReturn(reels, stake); details = { game: 'slots', reels, returned: payout };
   validate = () => { this.eligible(profileId, command.tableId, sessionId); if (table.view.phase !== 'idle') fail('machine_busy', 'This machine is occupied'); this.unoccupied(profileId, command.tableId); };
   apply = result => { occupant.departed = departed; table.player = occupant; table.outcome = reels; table.payout = payout; table.wagerId = result.wager.id; table.view.roundId = roundId; table.view.phase = 'spinning'; table.view.deadline = this.now() + SLOTS_SPIN_MS; table.view.stake = stake; table.view.returned = null; table.view.reels = []; };
  } else if (command.action === 'blackjack-bet') {
   const table = this.blackjack.get(command.tableId)!; stake = command.stake; roundId = command.roundId; details = { game: 'blackjack', action: 'bet' };
   validate = () => {
    this.eligible(profileId, command.tableId, sessionId); const seat = this.findSeat(table, profileId)?.[1];
    if (table.view.roundId !== roundId || table.view.phase !== 'betting' || this.now() >= table.view.deadline) fail('betting_closed', 'Blackjack betting has closed');
    if (!seat || !this.connected(seat.player, command.tableId)) fail('not_seated', 'Take a seat before betting');
    if (seat!.hands.length) fail('already_bet', 'You have already bet in this round');
   };
   apply = result => { this.findSeat(table, profileId)![1].hands.push({ cards: [], stake, wagers: [result.wager.id], split: false, state: 'playing' }); };
  } else {
   const { table, hand } = this.turn(profileId, command, sessionId);
   stake = hand.stake; roundId = command.roundId; details = { game: 'blackjack', action: command.move, hand: command.hand };
   validate = () => { this.turn(profileId, command, sessionId); };
   apply = result => {
    const seat = this.findSeat(table, profileId)![1];
    if (command.move === 'double') { hand.stake += stake; hand.wagers.push(result.wager.id); hand.cards.push(this.draw(table)); hand.state = total(hand.cards).total > 21 ? 'bust' : 'stood'; }
    else {
     const second = hand.cards.pop()!; hand.split = true;
     const other: Hand = { cards: [second], stake, wagers: [result.wager.id], split: true, state: 'playing' }; seat.hands.push(other);
     hand.cards.push(this.draw(table)); other.cards.push(this.draw(table));
     if (second.rank === 'A') { hand.state = 'stood'; other.state = 'stood'; }
     else { if (total(hand.cards).total === 21) hand.state = 'stood'; if (total(other.cards).total === 21) other.state = 'stood'; }
    }
    this.next(table);
   };
  }
  const input: WagerInput = { profileId, requestId: command.requestId, fingerprint, roomId: this.roomId, tableId: command.tableId, roundId, stake, details };
  let applied = false;
  return { depart: () => { departed = true; }, retryAt: 0, profileId, command, fingerprint, tableId: command.tableId, run: async () => {
   const result = await this.repository.accept(input, validate);
   if (command.action === 'slots-spin') {
    const wallets = await this.repository.settle([{ id: result.wager.id, returned: details.returned as number, outcome: { reels: details.reels } }]);
    result.wallet = wallets.get(profileId)!;
   }
   if (!applied) { apply(result); applied = true; }
   this.ok(profileId, command, fingerprint, { wallet: result.wallet, wagerId: result.wager.id, roundId, message: command.action === 'slots-spin' ? 'Spin accepted' : 'Wager accepted' });
  } };
 }
 private chooseCrapsShooter(rotate = false) {
  const t = this.craps, old = t.shooter;
  if (!rotate && old && this.connected(old, 'craps-1')) return;
  const index = t.bets.findIndex(b => b.profileId === old?.profileId);
  const ordered = [...t.bets.slice(index + 1), ...t.bets.slice(0, index + 1)];
  t.shooter = ordered.find(b => this.connected(b.player, 'craps-1'))?.player ?? null;
 }
 private async rollCraps() {
  const t = this.craps;
  // Freeze both dice before awaiting storage. A failed or ambiguous commit reuses this throw.
  if (!t.outcome) {
   t.throwingShooter = t.shooter;
   t.outcome = resolveCraps([this.random(6) + 1, this.random(6) + 1], t.view.point);
  }
  t.view.phase = 'paused';
  try {
   if (t.outcome.pointAfter === null) {
    const wallets = await this.repository.settle(t.bets.map(b => ({ id: b.wagerId, returned: crapsReturn(b.bet, t.outcome!), outcome: { ...t.outcome! } })));
    for (const [id, wallet] of wallets) this.hooks.wallet(id, wallet);
   }
   t.view.motion = { rollId: t.view.rollId, startedAt: this.now() + CRAPS_ROLL_LEAD_MS, dice: [...t.outcome.dice], previousDice: t.view.motion ? [...t.view.motion.dice] : [1, 1] };
   t.view.phase = 'rolling'; t.view.deadline = t.view.motion.startedAt + CRAPS_ROLL_MS;
  } catch { /* Paused with the exact pending throw; retry on the next serialized tick. */ }
 }
 private async tickCraps() {
  const t = this.craps, v = t.view;
  if (this.blocked(v.id)) return;
  this.chooseCrapsShooter();
  if (v.phase === 'betting' && this.now() >= v.deadline) {
   if (!t.bets.length) { v.roundId = randomUUID(); v.rollId = randomUUID(); v.deadline = this.now() + CRAPS_BETTING_MS; }
   else { v.phase = 'awaiting-roll'; v.deadline = this.now() + CRAPS_AWAITING_ROLL_MS; }
  }
  if ((v.phase === 'awaiting-roll' && this.now() >= v.deadline) || v.phase === 'paused') await this.rollCraps();
  if (v.phase === 'rolling' && this.now() >= v.deadline) {
   v.result = structuredClone(t.outcome!); v.point = t.outcome!.pointAfter; v.history = [structuredClone(t.outcome!), ...v.history].slice(0, 12);
   if (t.outcome!.pointBefore !== null && t.outcome!.total === 7 && t.shooter === t.throwingShooter) this.chooseCrapsShooter(true);
   v.phase = 'result'; v.deadline = this.now() + CASINO_RESULT_MS;
  }
  if (v.phase === 'result' && this.now() >= v.deadline) {
   t.outcome = null; t.throwingShooter = null; v.result = null; v.rollId = randomUUID();
   if (v.point === null) {
    const players = t.bets.map(b => b.profileId); t.bets = []; v.roundId = randomUUID(); v.phase = 'betting'; v.deadline = this.now() + CRAPS_BETTING_MS;
    for (const id of players) this.privateState(id);
   } else { v.phase = 'awaiting-roll'; v.deadline = this.now() + CRAPS_AWAITING_ROLL_MS; }
  }
 }
 private findSeat(table: Blackjack, profileId: string) { return [...table.seats.entries()].find(([, s]) => s.player.profileId === profileId); }
 private unoccupied(profileId: string, except?: CasinoTableId) {
  if (except !== 'poker-1' && this.poker?.hasSeat(profileId)) fail('already_seated', 'Leave your poker seat first');
  if ([...this.pending.values()].some(p => p.profileId === profileId && p.tableId !== except && !this.roulette.has(p.tableId) && p.tableId !== 'craps-1')) fail('already_seated', 'Wait for your current casino action to finish saving');
  for (const [id, table] of this.blackjack) if (id !== except && this.findSeat(table, profileId)) fail('already_seated', 'Leave your current casino station first');
  for (const [id, table] of this.slots) if (id !== except && table.player?.profileId === profileId) fail('already_seated', 'Wait for your current spin to finish');
 }
 private join(profileId: string, id: CasinoTableId, index: number) {
  const table = this.blackjack.get(id)!; this.unoccupied(profileId, id);
  const own = this.findSeat(table, profileId);
  if (own) { if (own[0] !== index) fail('already_seated', 'You already have a seat at this table'); own[1].player = this.occupant(profileId); return; }
  if (table.seats.has(index)) fail('seat_taken', 'Someone already has this seat');
  table.seats.set(index, { player: this.occupant(profileId), hands: [] });
 }
 private turn(profileId: string, command: Extract<CasinoCommand, { action: 'blackjack-action' }>, sessionId: string) {
  this.eligible(profileId, command.tableId, sessionId);
  const table = this.blackjack.get(command.tableId)!, seat = this.findSeat(table, profileId), hand = seat?.[1].hands[command.hand];
  if (table.view.roundId !== command.roundId || table.view.phase !== 'playing' || this.now() >= table.view.deadline || !seat || table.view.activeSeat !== seat[0] || table.view.activeHand !== command.hand || !hand || hand.state !== 'playing' || !this.connected(seat[1].player, command.tableId)) fail('not_your_turn', 'That hand is not waiting for your action');
  // Do not consult the projection's saving flag: this validation also runs under the wallet lock of its own pending action.
  if ((command.move === 'double' || command.move === 'split') && hand!.cards.length !== 2) fail('action_unavailable', 'This action requires your first two cards');
  if (command.move === 'split' && (seat![1].hands.length !== 1 || hand!.cards[0].rank !== hand!.cards[1].rank)) fail('action_unavailable', 'Only one split of identical ranks is allowed');
  return { table, hand: hand! };
 }
 private draw(table: Blackjack) { const card = table.cards.pop(); if (!card) throw new Error('Blackjack shoe exhausted'); return card; }
 private next(table: Blackjack) {
  const candidates = [...table.seats.entries()].sort(([a], [b]) => a - b);
  for (const [index, seat] of candidates) for (let hi = 0; hi < seat.hands.length; hi++) {
   const hand = seat.hands[hi];
   if (hand.state === 'playing') {
    if (!this.connected(seat.player, table.view.id)) { hand.state = 'stood'; continue; }
    table.view.activeSeat = index; table.view.activeHand = hi; table.view.deadline = this.now() + BLACKJACK_ACTION_MS; return;
   }
  }
  table.view.activeSeat = null; table.view.activeHand = null; table.view.phase = 'dealer'; table.view.deadline = this.now();
 }
 private deal(table: Blackjack) {
  table.cards = this.makeShoe(); table.dealer = []; table.revealed = false;
  const seats = [...table.seats.entries()].sort(([a], [b]) => a - b).map(([, s]) => s).filter(s => s.hands.length);
  if (!seats.length) { table.view.roundId = randomUUID(); table.view.deadline = this.now() + BLACKJACK_BETTING_MS; return; }
  for (let i = 0; i < 2; i++) { for (const seat of seats) seat.hands[0].cards.push(this.draw(table)); table.dealer.push(this.draw(table)); }
  for (const seat of seats) if (natural(seat.hands[0].cards)) seat.hands[0].state = 'blackjack';
  if (natural(table.dealer)) { table.view.phase = 'dealer'; table.view.deadline = this.now(); return; }
  table.view.phase = 'playing'; this.next(table);
 }
 private async finishBlackjack(table: Blackjack) {
  // Cards are drawn once; a settlement retry reuses the completed dealer hand.
  const hands = [...table.seats.values()].flatMap(s => s.hands);
  // The dealer completes to 17+ while any unbusted hand is live; naturals already pay before totals compare.
  if (hands.some(h => total(h.cards).total <= 21)) while (total(table.dealer).total < 17) table.dealer.push(this.draw(table));
  const entries = hands.flatMap(h => { const result = blackjackReturn(h.cards, table.dealer, h.stake, h.split); return h.wagers.map((id, i) => ({ id, returned: i === 0 ? result.returned : 0, outcome: { cards: h.cards, dealer: table.dealer, result: result.outcome } })); });
  const wallets = await this.repository.settle(entries);
  for (const [profileId, wallet] of wallets) this.hooks.wallet(profileId, wallet);
  for (const hand of hands) { Object.assign(hand, blackjackReturn(hand.cards, table.dealer, hand.stake, hand.split)); hand.state = 'settled'; }
  table.revealed = true; table.view.phase = 'result'; table.view.deadline = this.now() + CASINO_RESULT_MS;
 }
 private depart(profileId: string, id?: CasinoTableId) {
  if (!id || id === 'poker-1') this.poker?.leave(profileId);
  if (!id || id === 'craps-1') { for (const b of this.craps.bets) if (b.profileId === profileId) b.player.departed = true; if (this.craps.shooter?.profileId === profileId) this.craps.shooter.departed = true; this.chooseCrapsShooter(); }
  for (const operation of this.pending.values()) if (operation.profileId === profileId && (!id || id === operation.tableId)) operation.depart();
  for (const [tableId, table] of this.blackjack) if (!id || id === tableId) {
   const seat = this.findSeat(table, profileId); if (!seat) continue;
   seat[1].player.departed = true;
   if (!seat[1].hands.length && ![...this.pending.values()].some(p => p.profileId === profileId && p.tableId === tableId)) table.seats.delete(seat[0]);
   else if (table.view.phase === 'playing') { for (const hand of seat[1].hands) if (hand.state === 'playing') hand.state = 'stood'; this.next(table); }
  }
  for (const [tableId, table] of this.slots) if ((!id || id === tableId) && table.player?.profileId === profileId) table.player.departed = true;
 }
 leave(profileId: string) { void this.enqueue(async () => { this.depart(profileId); this.publish(); }); }
 async tick(_now?: number) {
  if (this.closed) return;
  return this.enqueue(async () => {
   if (this.closed) return;
   for (const [key, operation] of [...this.pending]) if (this.now() >= operation.retryAt) await this.attempt(key, operation, false);
   await this.tickCraps();
   await this.poker?.tick();
   for (const table of this.blackjack.values()) {
    if (this.blocked(table.view.id)) continue;
    for (const [index, seat] of table.seats) if (!this.connected(seat.player, table.view.id)) {
     if (!seat.hands.length) table.seats.delete(index);
     else if (table.view.phase === 'playing') for (const hand of seat.hands) if (hand.state === 'playing') hand.state = 'stood';
    }
    try {
     if (table.view.phase === 'betting' && this.now() >= table.view.deadline) this.deal(table);
     if (table.view.phase === 'playing') {
      const hand = table.seats.get(table.view.activeSeat!)?.hands[table.view.activeHand!];
      if (hand?.state === 'playing' && this.now() >= table.view.deadline) hand.state = 'stood';
      if (!hand || hand.state !== 'playing') this.next(table);
     }
     if (table.view.phase === 'dealer' || table.view.phase === 'paused') { try { await this.finishBlackjack(table); } catch { table.view.phase = 'paused'; } }
     if (table.view.phase === 'result' && this.now() >= table.view.deadline) {
      for (const [index, seat] of table.seats) { if (!this.connected(seat.player, table.view.id)) table.seats.delete(index); else seat.hands = []; }
      table.dealer = []; table.revealed = false; table.view.roundId = randomUUID(); table.view.phase = 'betting'; table.view.deadline = this.now() + BLACKJACK_BETTING_MS;
     }
    } catch { table.view.phase = 'paused'; }
   }
   for (const r of this.roulette.values()) if (!this.blocked(r.view.id)) {
    if (r.view.phase === 'betting' && this.now() >= r.view.deadline) {
     r.outcome = this.random(37); r.view.phase = 'spinning';
     r.view.motion = startRouletteMotion(r.view.roundId, this.now(), r.view.motion);
     r.view.deadline = this.now() + ROULETTE_SPIN_MS;
    }
    if ((r.view.phase === 'spinning' && this.now() >= r.view.deadline) || r.view.phase === 'paused') {
     try {
      const wallets = await this.repository.settle(r.bets.map(b => ({ id: b.wagerId, returned: rouletteReturn(b.bet, r.outcome!), outcome: { number: r.outcome } })));
      for (const [profileId, wallet] of wallets) this.hooks.wallet(profileId, wallet);
      const landingAt = this.now() + ROULETTE_LANDING_LEAD_MS;
      r.view.motion = { ...r.view.motion!, landingAt, number: r.outcome };
      r.view.result = r.outcome; r.view.phase = 'landing'; r.view.deadline = landingAt + ROULETTE_LANDING_MS;
     } catch { r.view.phase = 'paused'; }
    }
    if (r.view.phase === 'landing' && this.now() >= r.view.deadline) {
     r.view.history = [r.outcome!, ...r.view.history].slice(0, 12);
     r.view.phase = 'result'; r.view.deadline = this.now() + CASINO_RESULT_MS;
    }
    if (r.view.phase === 'result' && this.now() >= r.view.deadline) {
     const players = new Set(r.bets.map(b => b.profileId)); r.bets = []; r.outcome = null; r.view.result = null; r.view.roundId = randomUUID(); r.view.phase = 'betting'; r.view.deadline = this.now() + ROULETTE_BETTING_MS;
     for (const profileId of players) this.privateState(profileId);
    }
   }
   for (const table of this.slots.values()) if (!this.blocked(table.view.id)) {
    if (table.view.phase === 'spinning' || table.view.phase === 'paused') {
     try {
      if (this.now() >= table.view.deadline) { table.view.reels = [...table.outcome]; table.view.returned = table.payout; table.view.phase = 'result'; table.view.deadline = this.now() + CASINO_RESULT_MS; }
      else table.view.phase = 'spinning';
     } catch { table.view.phase = 'paused'; }
    }
    if (table.view.phase === 'result' && this.now() >= table.view.deadline) { table.player = null; table.wagerId = null; table.view.phase = 'idle'; table.view.deadline = 0; }
   }
   this.publish();
  });
 }
 async dispose() {
  this.closed = true; if (this.timer) clearInterval(this.timer); this.timer = undefined;
  await this.queue;
  const wallets = await this.repository.recoverPending(this.roomId);
  for (const [profileId, wallet] of wallets) this.hooks.wallet(profileId, wallet);
  this.pending.clear(); this.receipts.clear();
 }
}
