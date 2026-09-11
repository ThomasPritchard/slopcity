import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Card } from '../shared/casino.ts';
import { rankPoker, comparePokerRanks, pokerDeck, pokerPots } from '../server/casino/pokerRules.ts';
const cards = (text: string): Card[] => text.split(' ').map(c => ({ rank: c.slice(0, -1) as Card['rank'], suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[c.slice(-1) as 'c'] }));
test('Seven-card evaluator compares categories, kickers, wheel, double trips and best five', () => {
 const hands = ['2c 5d 7s 9h Jc', '2c 2d 7s 9h Jc', '2c 2d 7s 7h Jc', '2c 2d 2s 9h Jc', '2c 3d 4s 5h 6c', '2c 5c 7c 9c Jc', '2c 2d 2s 9h 9c', '2c 2d 2s 2h Jc', '2c 3c 4c 5c 6c'].map(h => rankPoker(cards(h)));
 hands.forEach((h, i) => { assert.equal(h.values[0], i); if (i) assert.ok(comparePokerRanks(h, hands[i - 1]) > 0); });
 assert.deepEqual(rankPoker(cards('Ac 2d 3s 4h 5c Kh Qd')).values, [4, 5]);
 assert.deepEqual(rankPoker(cards('Ac Ad As Kh Kc Kd 2s')).values, [6, 14, 13]);
 assert.deepEqual(rankPoker(cards('Ac Kc Qc Jc 10c 2d 3d')).values, [8, 14]);
 assert.ok(comparePokerRanks(rankPoker(cards('Ac Ad Ks Qc 9s 3h 2h')), rankPoker(cards('As Ah Kd Jc 10s 3c 2c'))) > 0);
 assert.throws(() => rankPoker(cards('Ac Ac Ks Qc 9s')));
 const deck = pokerDeck(); assert.equal(deck.length, 52); assert.equal(new Set(deck.map(c => `${c.rank}:${c.suit}`)).size, 52);
});
test('Contribution layers pay main and side pots separately, retaining folded dead money', () => {
 const result = pokerPots([
  { seat: 0, committed: 100, folded: false, cards: cards('Ac Ad') },
  { seat: 1, committed: 200, folded: false, cards: cards('Kc Kd') },
  { seat: 2, committed: 300, folded: false, cards: cards('Qc Qd') },
  { seat: 3, committed: 300, folded: true, cards: cards('Jc Jd') },
 ], cards('2c 4d 6h 8s 10c'), 0);
 assert.deepEqual(result.pots.map(p => p.amount), [400, 300, 200]);
 assert.deepEqual([...result.returns], [[0, 400], [1, 300], [2, 200]]);
 assert.equal([...result.returns.values()].reduce((a, b) => a + b, 0), 900);
});
test('Board ties split odd chips clockwise after button, and unmatched excess returns to contributor', () => {
 const players = [0, 2, 4].map((seat, i) => ({ seat, committed: 5, folded: i === 2, cards: cards(['2c 3c', '4c 5c', '6c 7c'][i]) }));
 const result = pokerPots(players, cards('Ah Kh Qh Jh 10h'), 0);
 assert.equal(result.returns.get(2), 8); assert.equal(result.returns.get(0), 7);
 const unmatched = pokerPots([{ seat: 0, committed: 50, folded: true, cards: cards('2c 3c') }, { seat: 1, committed: 100, folded: false, cards: cards('4c 5c') }], [], 0);
 assert.equal(unmatched.returns.get(1), 150); assert.equal(unmatched.refunds.get(1), 50); assert.equal(unmatched.pots.length, 1); assert.equal(unmatched.winners[0].amount, 100);
});
test('Uncalled excess neither overwrites a winning hand nor labels a losing contributor as a winner', () => {
 for (const largerWins of [false, true]) {
  const result = pokerPots([
   { seat: 0, committed: 400, folded: false, cards: cards(largerWins ? 'Ac Ad' : 'Kc Kd') },
   { seat: 1, committed: 200, folded: false, cards: cards(largerWins ? 'Kc Kd' : 'Ac Ad') },
  ], cards('2c 4d 6h 8s 10c'), 0);
  assert.deepEqual(result.pots.map(p => p.amount), [400]);
  assert.deepEqual(result.winners, [{ seat: largerWins ? 0 : 1, amount: 400, hand: 'One pair' }]);
  assert.equal(result.refunds.get(0), 200);
  assert.equal(result.returns.get(0), largerWins ? 600 : 200);
  assert.equal([...result.returns.values()].reduce((a, b) => a + b, 0), 600);
 }
});
