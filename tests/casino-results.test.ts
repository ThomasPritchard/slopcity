import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CasinoResultFeed, summariseCasinoResult } from '../src/casino/casinoResults.ts';
import { rouletteChoices } from '../src/casino/rouletteChoices.ts';
import type { BlackjackView, CasinoPrivateState, RouletteView, SlotsView } from '../shared/casino.ts';
import type { PokerView } from '../shared/poker.ts';
import { resolveCraps, type CrapsView } from '../shared/craps.ts';
import { rouletteChipPosition } from '../shared/rouletteLayout.ts';

const roulette: RouletteView = { id: 'roulette-1', game: 'roulette', roundId: 'round', phase: 'result', deadline: 2000, result: 1, betCount: 2, history: [1], motion: null };
const empty: CasinoPrivateState = { rouletteBets: [] };
const own: CasinoPrivateState = { rouletteBets: [
  { tableId: 'roulette-1', roundId: 'round', wagerId: 'red', bet: { kind: 'red', numbers: rouletteChoices('red')[0], stake: 10 } },
  { tableId: 'roulette-1', roundId: 'round', wagerId: 'black', bet: { kind: 'black', numbers: rouletteChoices('black')[0], stake: 20 } },
] };

test('Roulette announces net loss on mixed bets, waits for physical landing, and excludes spectators/other rounds', () => {
  assert.equal(summariseCasinoResult(roulette, own, 'alice')?.net, -10);
  assert.equal(summariseCasinoResult({ ...roulette, phase: 'landing' }, own, 'alice'), null);
  assert.equal(summariseCasinoResult(roulette, empty, 'alice'), null);
  assert.equal(summariseCasinoResult({ ...roulette, roundId: 'next' }, own, 'alice'), null);
  assert.equal(summariseCasinoResult({ ...roulette, id: 'roulette-2' }, own, 'alice'), null);
  assert.equal(summariseCasinoResult({ ...roulette, result: 0 }, own, 'alice')?.net, -30);
});

test('Result feed tolerates public/private ordering and repeated snapshots without repeating announcements', () => {
  const feed = new CasinoResultFeed();
  assert.deepEqual(feed.collect([roulette], empty, 'alice'), []);
  assert.equal(feed.collect([roulette], own, 'alice').length, 1);
  assert.deepEqual(feed.collect([structuredClone(roulette)], structuredClone(own), 'alice'), []);
  assert.deepEqual(feed.collect([{ ...roulette, phase: 'betting' }], own, 'alice'), []);
  assert.deepEqual(feed.collect([roulette], own, 'alice'), []);
});

test('Blackjack combines split and doubled stakes; slots distinguish a push from a win and another player', () => {
  const blackjack: BlackjackView = { id: 'blackjack-1', game: 'blackjack', roundId: 'hand', phase: 'result', deadline: 2000, dealer: [], dealerTotal: 19, activeSeat: null, activeHand: null, seats: [{ seat: 0, player: { profileId: 'alice', name: 'Alice', connected: true }, hands: [
    { cards: [], stake: 20, total: 20, soft: false, state: 'settled', outcome: 'win', returned: 40, actions: [] },
    { cards: [], stake: 10, total: 18, soft: false, state: 'settled', outcome: 'lose', returned: 0, actions: [] },
  ] }] };
  assert.equal(summariseCasinoResult(blackjack, empty, 'alice')?.net, 10);
  const slots: SlotsView = { id: 'slots-1', game: 'slots', roundId: 'spin', phase: 'result', deadline: 2000, player: blackjack.seats[0].player, reels: ['cherry', 'cherry', 'bar'], stake: 10, returned: 10 };
  assert.equal(summariseCasinoResult(slots, empty, 'alice')?.net, 0);
  assert.equal(summariseCasinoResult(slots, empty, 'bob'), null);
  assert.equal(summariseCasinoResult({ ...slots, phase: 'spinning' }, empty, 'alice'), null);
});

test('Craps announces terminal bets only; poker subtracts matched contribution from pot awards in table chips', () => {
  const craps: CrapsView = { id: 'craps-1', game: 'craps', roundId: 'cycle', rollId: 'roll', phase: 'result', deadline: 2000, point: null, shooter: null, betCount: 1, result: resolveCraps([6, 6], null), history: [], motion: null };
  const privateState: CasinoPrivateState = { ...empty, crapsBets: [{ tableId: 'craps-1', roundId: 'cycle', wagerId: 'line', bet: { kind: 'dont-pass', stake: 10 } }] };
  assert.equal(summariseCasinoResult(craps, privateState, 'alice')?.net, 0);
  assert.equal(summariseCasinoResult({ ...craps, result: resolveCraps([2, 2], null) }, privateState, 'alice'), null);
  const poker: PokerView = { id: 'poker-1', game: 'poker', roundId: 'poker-hand', handId: 'poker-hand', phase: 'result', deadline: 2000, button: 0, smallBlindSeat: 0, bigBlindSeat: 1, activeSeat: null, board: [], pot: 120, currentBet: 0, seats: [{ seat: 0, player: { profileId: 'alice', name: 'Alice', connected: true }, stack: 50, bet: 0, committed: 70, state: 'all-in', leaving: false, cards: [] }], pots: [], winners: [{ seat: 0, amount: 50, hand: 'One pair' }, { seat: 1, amount: 70, hand: 'Two pair' }], message: '' };
  assert.equal(summariseCasinoResult(poker, empty, 'alice')?.net, -20, 'A small side-pot award is still a net loss');
  assert.equal(summariseCasinoResult(poker, empty, 'alice')?.unit, 'table chips');
  assert.equal(summariseCasinoResult({ ...poker, seats: [{ ...poker.seats[0], state: 'waiting' }] }, empty, 'alice'), null);
});

test('Outside roulette wagers sit on the authored labels, including all dozens and columns', () => {
  for (const [index, kind] of (['low', 'even', 'red', 'black', 'odd', 'high'] as const).entries()) {
    const point = rouletteChipPosition({ kind, numbers: rouletteChoices(kind)[0], stake: 10 });
    assert.ok(Math.abs(point.x - (-.05 + .4 * index)) < 1e-9);
    assert.equal(point.z, -.525);
  }
  for (const [index, numbers] of rouletteChoices('dozen').entries()) {
    const point = rouletteChipPosition({ kind: 'dozen', numbers: [...numbers].reverse(), stake: 10 });
    assert.ok(Math.abs(point.x - (.15 + .8 * index)) < 1e-9);
    assert.equal(point.z, -.375);
  }
  for (const [index, numbers] of rouletteChoices('column').entries()) {
    assert.deepEqual(rouletteChipPosition({ kind: 'column', numbers, stake: 10 }), { x: 2.29, z: [.44, .17, -.10][index] });
  }
});
