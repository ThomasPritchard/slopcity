import type { Card, CasinoOccupant } from './casino.ts';

export const POKER_SMALL_BLIND = 5;
export const POKER_BIG_BLIND = 10;
export const POKER_MIN_BUY_IN = 200;
export const POKER_MAX_BUY_IN = 1000;
export const POKER_BUY_IN_STEP = 100;
export const POKER_DEFAULT_BUY_IN = 500;
export const POKER_TURN_MS = 20_000;
export const POKER_BREAK_MS = 8000;
export const POKER_RUNOUT_MS = 1200;
export type PokerMove = 'fold' | 'check' | 'call' | 'raise' | 'all-in';
export type PokerPhase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'runout' | 'result' | 'paused';
export type PokerSeatView = {
  seat: number; player: CasinoOccupant; stack: number; bet: number; committed: number;
  state: 'waiting' | 'playing' | 'folded' | 'all-in'; leaving: boolean;
  /** Empty outside a hand; backs during play; only eligible showdown hands are exposed. */
  cards: (Card | null)[];
};
export type PokerPot = { amount: number; eligibleSeats: number[]; winnerSeats: number[] };
export type PokerWinner = { seat: number; amount: number; hand: string };
export type PokerView = {
  id: 'poker-1'; game: 'poker'; roundId: string; handId: string | null;
  phase: PokerPhase; deadline: number; button: number | null; smallBlindSeat: number | null; bigBlindSeat: number | null;
  activeSeat: number | null; board: Card[]; pot: number; currentBet: number; seats: PokerSeatView[];
  pots: PokerPot[]; winners: PokerWinner[]; message: string;
};
export type PokerLegalActions = {
  turnId: string; canFold: boolean; canCheck: boolean; canCall: boolean; callAmount: number;
  canRaise: boolean; minRaiseTo: number; maxRaiseTo: number; canAllIn: boolean;
};
export type PokerPrivateState = {
  tableId: 'poker-1'; escrowId: string; seat: number; handId: string | null;
  holeCards: Card[]; actions: PokerLegalActions | null; canRejoin: boolean;
};
export type PokerCommand = { requestId: string; tableId: 'poker-1' } & (
  | { action: 'poker-join'; seat: number; buyIn: number }
  | { action: 'poker-rejoin'; escrowId: string }
  | { action: 'poker-action'; handId: string; turnId: string; move: PokerMove; raiseTo?: number }
  | { action: 'poker-leave'; escrowId: string }
);
