import { randomInt } from 'node:crypto';
import { CASINO_MIN_STAKE, CASINO_MAX_STAKE, CASINO_STAKE_STEP, ROULETTE_RED_NUMBERS, ROULETTE_PROFIT_MULTIPLIER, SLOT_SYMBOLS, SLOT_REEL_WEIGHTS, type RouletteBet, type RouletteBetKind, type Card, type SlotSymbol } from '../../shared/casino.ts';
import { EconomyError } from '../persistence/economy.ts';
export type Random = (max: number) => number;
export const cryptoRandom: Random = max => randomInt(max);
export function validStake(stake: unknown): stake is number { return Number.isSafeInteger(stake) && Number(stake) >= CASINO_MIN_STAKE && Number(stake) <= CASINO_MAX_STAKE && Number(stake) % CASINO_STAKE_STEP === 0; }
const range = (start: number, length: number) => Array.from({ length }, (_, i) => start + i);
const canonical = new Map<RouletteBetKind, number[][]>();
const add = (kind: RouletteBetKind, nums: number[]) => canonical.set(kind, [...(canonical.get(kind) ?? []), nums]);
for (let n = 0; n <= 36; n++) add('straight', [n]);
for (let n = 1; n <= 36; n++) {
 if (n % 3 !== 0) add('split', [n, n + 1]);
 if (n <= 33) add('split', [n, n + 3]);
 if (n % 3 === 1) add('street', range(n, 3));
 if (n <= 32 && n % 3 !== 0) add('corner', [n, n + 1, n + 3, n + 4]);
 if (n <= 31 && n % 3 === 1) add('six-line', range(n, 6));
}
for (const n of [1, 2, 3]) add('split', [0, n]);
add('trio', [0, 1, 2]); add('trio', [0, 2, 3]); add('first-four', [0, 1, 2, 3]);
add('red', [...ROULETTE_RED_NUMBERS]); add('black', range(1, 36).filter(n => !(ROULETTE_RED_NUMBERS as readonly number[]).includes(n)));
add('odd', range(1, 36).filter(n => n % 2 === 1)); add('even', range(1, 36).filter(n => n % 2 === 0));
add('low', range(1, 18)); add('high', range(19, 18));
for (let i = 0; i < 3; i++) { add('dozen', range(1 + 12 * i, 12)); add('column', range(0, 12).map(n => n * 3 + i + 1)); }
export function rouletteBet(value: unknown): RouletteBet {
 if (!value || typeof value !== 'object') throw new EconomyError('invalid_bet', 'Choose a roulette bet', 400);
 const { kind, numbers, stake } = value as RouletteBet;
 if (!validStake(stake) || !Array.isArray(numbers) || numbers.some(n => !Number.isInteger(n))) throw new EconomyError('invalid_bet', 'Choose valid numbers and a stake in steps of 10', 400);
 const sorted = [...numbers].sort((a, b) => a - b);
 if (!canonical.get(kind)?.some(ns => ns.length === sorted.length && ns.every((n, i) => n === sorted[i]))) throw new EconomyError('invalid_bet', 'Those numbers do not form that roulette bet', 400);
 return { kind, numbers: sorted, stake };
}
export function rouletteReturn(bet: RouletteBet, result: number) { return bet.numbers.includes(result) ? bet.stake * (ROULETTE_PROFIT_MULTIPLIER[bet.kind] + 1) : 0; }
export function total(cards: readonly Card[]) {
 let value = cards.reduce((sum, c) => sum + (c.rank === 'A' ? 11 : ['J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank)), 0);
 let aces = cards.filter(c => c.rank === 'A').length;
 while (value > 21 && aces > 0) { value -= 10; aces--; }
 return { total: value, soft: aces > 0 };
}
export function natural(cards: readonly Card[]) { return cards.length === 2 && total(cards).total === 21; }
export function shoe(random: Random = cryptoRandom): Card[] {
 const ranks: Card['rank'][] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
 const suits: Card['suit'][] = ['clubs', 'diamonds', 'hearts', 'spades'];
 const cards = Array.from({ length: 6 }, () => suits.flatMap(suit => ranks.map(rank => ({ rank, suit })))).flat();
 for (let i = cards.length - 1; i > 0; i--) { const j = random(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
 return cards;
}
export function blackjackReturn(cards: readonly Card[], dealer: readonly Card[], stake: number, split: boolean) {
 const player = total(cards).total, house = total(dealer).total;
 if (player > 21) return { outcome: 'lose' as const, returned: 0 };
 if (natural(dealer)) return !split && natural(cards) ? { outcome: 'push' as const, returned: stake } : { outcome: 'lose' as const, returned: 0 };
 if (!split && natural(cards)) return { outcome: 'blackjack' as const, returned: stake * 2.5 };
 if (house > 21 || player > house) return { outcome: 'win' as const, returned: stake * 2 };
 if (player === house) return { outcome: 'push' as const, returned: stake };
 return { outcome: 'lose' as const, returned: 0 };
}
export function slotReels(random: Random = cryptoRandom): SlotSymbol[] {
 return Array.from({ length: 3 }, () => {
  let stop = random(16);
  for (const symbol of SLOT_SYMBOLS) { stop -= SLOT_REEL_WEIGHTS[symbol]; if (stop < 0) return symbol; }
  throw new Error('Invalid random reel stop');
 });
}
export function slotsReturn(reels: readonly SlotSymbol[], stake: number) {
 if (reels.length !== 3) throw new Error('Slots require three reels');
 if (reels.every(s => s === reels[0])) return stake * ({ cherry: 3, lemon: 8, bar: 20, seven: 50 }[reels[0]]);
 return reels.filter(s => s === 'cherry').length === 2 ? stake : 0;
}
