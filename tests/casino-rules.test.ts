import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rouletteBet, rouletteReturn, total, natural, blackjackReturn, shoe, slotReels, slotsReturn } from '../server/casino/rules.ts';
import { ROULETTE_RED_NUMBERS, type Card, type RouletteBetKind } from '../shared/casino.ts';
const cards = (...ranks: Card['rank'][]): Card[] => ranks.map(rank => ({ rank, suit: 'hearts' }));
test('European roulette canonical geometry, every number, all outside bets and gross payouts', () => {
 for (let n = 0; n <= 36; n++) assert.equal(rouletteReturn(rouletteBet({ kind: 'straight', numbers: [n], stake: 10 }), n), 360);
 const selections: [RouletteBetKind, number[], number][] = [
  ['split', [0, 3], 180], ['split', [31, 34], 180], ['street', [34, 35, 36], 120], ['trio', [0, 2, 3], 120],
  ['corner', [32, 33, 35, 36], 90], ['first-four', [0, 1, 2, 3], 90], ['six-line', [31, 32, 33, 34, 35, 36], 60],
  ['red', [...ROULETTE_RED_NUMBERS], 20], ['black', Array.from({ length: 36 }, (_, i) => i + 1).filter(n => !(ROULETTE_RED_NUMBERS as readonly number[]).includes(n)), 20],
  ['odd', Array.from({ length: 18 }, (_, i) => i * 2 + 1), 20], ['even', Array.from({ length: 18 }, (_, i) => i * 2 + 2), 20],
  ['low', Array.from({ length: 18 }, (_, i) => i + 1), 20], ['high', Array.from({ length: 18 }, (_, i) => i + 19), 20],
  ['dozen', Array.from({ length: 12 }, (_, i) => i + 25), 30], ['column', Array.from({ length: 12 }, (_, i) => 3 * i + 2), 30],
 ];
 for (const [kind, numbers, returned] of selections) {
  const bet = rouletteBet({ kind, numbers: [...numbers].reverse(), stake: 10 });
  assert.equal(rouletteReturn(bet, numbers[0]), returned, kind);
  if (!numbers.includes(0)) assert.equal(rouletteReturn(bet, 0), 0, `${kind} loses on zero`);
 }
 for (const [kind, numbers] of [['split', [3, 4]], ['split', [0, 4]], ['street', [2, 3, 4]], ['trio', [0, 1, 3]], ['corner', [3, 4, 6, 7]], ['six-line', [2, 3, 4, 5, 6, 7]], ['straight', [1, 1]], ['red', [1]]] as const) assert.throws(() => rouletteBet({ kind, numbers, stake: 10 }));
 for (const stake of [0, -10, 11, 101, NaN, Infinity, '10']) assert.throws(() => rouletteBet({ kind: 'straight', numbers: [0], stake }));
});
test('Blackjack aces, naturals, split 21, busts, pushes and six-deck shuffle domain', () => {
 assert.deepEqual(total(cards('A', 'A', '5')), { total: 17, soft: true });
 assert.deepEqual(total(cards('A', '6', 'K')), { total: 17, soft: false });
 assert.equal(natural(cards('A', 'K')), true); assert.equal(natural(cards('A', '5', '5')), false);
 assert.deepEqual(blackjackReturn(cards('A', 'K'), cards('9', 'K'), 10, false), { outcome: 'blackjack', returned: 25 });
 assert.deepEqual(blackjackReturn(cards('A', 'K'), cards('9', 'K'), 10, true), { outcome: 'win', returned: 20 });
 assert.deepEqual(blackjackReturn(cards('A', 'K'), cards('A', 'Q'), 10, false), { outcome: 'push', returned: 10 });
 assert.deepEqual(blackjackReturn(cards('A', 'K'), cards('A', 'Q'), 10, true), { outcome: 'lose', returned: 0 });
 assert.deepEqual(blackjackReturn(cards('K', '8'), cards('Q', '8'), 10, false), { outcome: 'push', returned: 10 });
 assert.equal(blackjackReturn(cards('K', '8', '9'), cards('Q', '8', '9'), 10, false).returned, 0);
 const deck = shoe(max => max - 1); assert.equal(deck.length, 312);
 for (const rank of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']) assert.equal(deck.filter(c => c.rank === rank).length, 24);
});
test('Slot stops exactly match weights and every visible paytable entry', () => {
 const counts = { cherry: 0, lemon: 0, bar: 0, seven: 0 };
 for (let stop = 0; stop < 16; stop++) counts[slotReels(() => stop)[0]]++;
 assert.deepEqual(counts, { cherry: 7, lemon: 4, bar: 3, seven: 2 });
 for (const [symbol, multiplier] of [['cherry', 3], ['lemon', 8], ['bar', 20], ['seven', 50]] as const) assert.equal(slotsReturn([symbol, symbol, symbol], 10), multiplier * 10);
 assert.equal(slotsReturn(['cherry', 'bar', 'cherry'], 10), 10); assert.equal(slotsReturn(['bar', 'cherry', 'cherry'], 10), 10);
 assert.equal(slotsReturn(['lemon', 'bar', 'cherry'], 10), 0); assert.equal(slotsReturn(['bar', 'bar', 'cherry'], 10), 0);
 let returns = 0;
 for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) for (let c = 0; c < 16; c++) { const stops = [a, b, c]; returns += slotsReturn(slotReels(() => stops.shift()!), 10); }
 assert.equal(returns / (4096 * 10), 3804 / 4096);
});
