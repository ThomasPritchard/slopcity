import type { WalletState } from './catalog.ts';

export type CasinoGame = 'roulette' | 'blackjack' | 'slots';
export type CasinoTableId = 'roulette-1' | 'blackjack-1' | 'blackjack-2' | 'slots-1' | 'slots-2' | 'slots-3' | 'slots-4' | 'slots-5' | 'slots-6';
export type CasinoAnchor = { id: CasinoTableId; game: CasinoGame; name: string; x: number; z: number };
export const CASINO_ANCHORS: readonly CasinoAnchor[] = [
  { id: 'roulette-1', game: 'roulette', name: 'European roulette', x: -8, z: 20 },
  { id: 'blackjack-1', game: 'blackjack', name: 'Blackjack · Table 1', x: 3, z: 19 },
  { id: 'blackjack-2', game: 'blackjack', name: 'Blackjack · Table 2', x: 10, z: 19 },
  { id: 'slots-1', game: 'slots', name: 'Meridian reels · 1', x: -12, z: 24 },
  { id: 'slots-2', game: 'slots', name: 'Meridian reels · 2', x: -7, z: 24 },
  { id: 'slots-3', game: 'slots', name: 'Meridian reels · 3', x: -2, z: 24 },
  { id: 'slots-4', game: 'slots', name: 'Meridian reels · 4', x: 3, z: 24 },
  { id: 'slots-5', game: 'slots', name: 'Meridian reels · 5', x: 8, z: 24 },
  { id: 'slots-6', game: 'slots', name: 'Meridian reels · 6', x: 13, z: 24 },
];
export const CASINO_INTERACTION_RADIUS = 3.2;
export const CASINO_MIN_STAKE = 10;
export const CASINO_MAX_STAKE = 100;
export const CASINO_STAKE_STEP = 10;
export const ROULETTE_BETTING_MS = 20_000;
export const ROULETTE_SPIN_MS = 5_000;
export const CASINO_RESULT_MS = 6_000;
export const BLACKJACK_BETTING_MS = 20_000;
export const BLACKJACK_ACTION_MS = 30_000;
export const SLOTS_SPIN_MS = 2_500;

export type RouletteBetKind = 'straight' | 'split' | 'street' | 'trio' | 'corner' | 'first-four' | 'six-line' | 'red' | 'black' | 'odd' | 'even' | 'low' | 'high' | 'dozen' | 'column';
/** Exact covered numbers, validated against the canonical geometry for the chosen kind. */
export type RouletteBet = { kind: RouletteBetKind; numbers: number[]; stake: number };
export const ROULETTE_PROFIT_MULTIPLIER: Readonly<Record<RouletteBetKind, number>> = {
  straight: 35, split: 17, street: 11, trio: 11, corner: 8, 'first-four': 8, 'six-line': 5,
  red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1, dozen: 2, column: 2,
};
export const ROULETTE_RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36] as const;
export type Card = { rank: 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K'; suit: 'clubs' | 'diamonds' | 'hearts' | 'spades' };
export type BlackjackAction = 'hit' | 'stand' | 'double' | 'split';
export type BlackjackHandView = { cards: Card[]; stake: number; total: number; soft: boolean; state: 'playing' | 'stood' | 'bust' | 'blackjack' | 'settled'; outcome?: 'win' | 'lose' | 'push' | 'blackjack'; returned?: number; actions: BlackjackAction[] };
export type CasinoOccupant = { profileId: string; name: string; connected: boolean };
export type BlackjackSeatView = { seat: number; player: CasinoOccupant; hands: BlackjackHandView[] };
export type SlotSymbol = 'cherry' | 'lemon' | 'bar' | 'seven';
/** Gross return includes the stake; exactly two cherries pays only the final line. */
export const SLOT_PAYTABLE: readonly { label: string; symbol: SlotSymbol; count: 2 | 3; multiplier: number }[] = [
  { label: 'Three sevens', symbol: 'seven', count: 3, multiplier: 50 },
  { label: 'Three bars', symbol: 'bar', count: 3, multiplier: 20 },
  { label: 'Three lemons', symbol: 'lemon', count: 3, multiplier: 8 },
  { label: 'Three cherries', symbol: 'cherry', count: 3, multiplier: 3 },
  { label: 'Exactly two cherries, anywhere', symbol: 'cherry', count: 2, multiplier: 1 },
];
export const SLOT_SYMBOLS: readonly SlotSymbol[] = ['cherry', 'lemon', 'bar', 'seven'];
export const SLOT_REEL_WEIGHTS: Readonly<Record<SlotSymbol, number>> = { cherry: 7, lemon: 4, bar: 3, seven: 2 };
export const BLACKJACK_SEAT_OFFSETS: readonly { x: number; z: number; heading: number }[] = [
  { x: -1.8, z: -.6, heading: 1.249 },
  { x: -1.15, z: -1.5, heading: .654 },
  { x: 0, z: -1.9, heading: 0 },
  { x: 1.15, z: -1.5, heading: -.654 },
  { x: 1.8, z: -.6, heading: -1.249 },
];
export type RouletteView = { id: 'roulette-1'; game: 'roulette'; roundId: string; phase: 'betting' | 'spinning' | 'result' | 'paused'; deadline: number; result: number | null; betCount: number; history: number[] };
export type BlackjackView = { id: 'blackjack-1' | 'blackjack-2'; game: 'blackjack'; roundId: string; phase: 'betting' | 'playing' | 'dealer' | 'result' | 'paused'; deadline: number; dealer: (Card | null)[]; dealerTotal: number | null; seats: BlackjackSeatView[]; activeSeat: number | null; activeHand: number | null };
export type SlotsView = { id: CasinoTableId; game: 'slots'; roundId: string; phase: 'idle' | 'spinning' | 'result' | 'paused'; deadline: number; player: CasinoOccupant | null; reels: SlotSymbol[]; stake: number; returned: number | null };
export type CasinoTableView = RouletteView | BlackjackView | SlotsView;
export type CasinoState = { serverTime: number; tables: CasinoTableView[] };
export type CasinoCommand = { requestId: string } & (
  | { action: 'sync' }
  | { action: 'roulette-bet'; tableId: 'roulette-1'; roundId: string; bet: RouletteBet }
  | { action: 'blackjack-join'; tableId: 'blackjack-1' | 'blackjack-2'; seat: number }
  | { action: 'blackjack-bet'; tableId: 'blackjack-1' | 'blackjack-2'; roundId: string; stake: number }
  | { action: 'blackjack-action'; tableId: 'blackjack-1' | 'blackjack-2'; roundId: string; hand: number; move: BlackjackAction }
  | { action: 'slots-spin'; tableId: CasinoTableId; stake: number }
  | { action: 'leave'; tableId: CasinoTableId }
);
export type CasinoReceipt = { requestId: string; ok: boolean; code?: string; message: string; wallet?: WalletState; wagerId?: string; roundId?: string };
export type CasinoPrivateState = { rouletteBets: { wagerId: string; roundId: string; bet: RouletteBet }[] };
