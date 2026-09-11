import type { Card } from '../../shared/casino.ts';
import type { PokerPot, PokerWinner } from '../../shared/poker.ts';
import { cryptoRandom, type Random } from './rules.ts';
const ranks: Card['rank'][] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const labels = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
export type PokerRank = { values: number[]; name: string };
export function comparePokerRanks(a: PokerRank, b: PokerRank): number {
 for (let i = 0; i < Math.max(a.values.length, b.values.length); i++) { const d = (a.values[i] ?? 0) - (b.values[i] ?? 0); if (d) return d; }
 return 0;
}
function five(cards: readonly Card[]): PokerRank {
 const ns = cards.map(c => ranks.indexOf(c.rank) + 2).sort((a, b) => b - a);
 const counts = new Map<number, number>(); for (const n of ns) counts.set(n, (counts.get(n) ?? 0) + 1);
 const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
 const flush = cards.every(c => c.suit === cards[0].suit);
 const straight = counts.size === 5 ? ns[0] - ns[4] === 4 ? ns[0] : ns.join(',') === '14,5,4,3,2' ? 5 : 0 : 0;
 let values: number[];
 if (flush && straight) values = [8, straight];
 else if (groups[0][1] === 4) values = [7, groups[0][0], groups[1][0]];
 else if (groups[0][1] === 3 && groups[1][1] === 2) values = [6, groups[0][0], groups[1][0]];
 else if (flush) values = [5, ...ns];
 else if (straight) values = [4, straight];
 else if (groups[0][1] === 3) values = [3, groups[0][0], ...groups.slice(1).map(g => g[0])];
 else if (groups[0][1] === 2 && groups[1][1] === 2) values = [2, Math.max(groups[0][0], groups[1][0]), Math.min(groups[0][0], groups[1][0]), groups[2][0]];
 else if (groups[0][1] === 2) values = [1, groups[0][0], ...groups.slice(1).map(g => g[0])];
 else values = [0, ...ns];
 return { values, name: labels[values[0]] };
}
export function rankPoker(cards: readonly Card[]): PokerRank {
 if (cards.length < 5 || cards.length > 7 || new Set(cards.map(c => `${c.rank}:${c.suit}`)).size !== cards.length || cards.some(c => !ranks.includes(c.rank) || !['clubs', 'diamonds', 'hearts', 'spades'].includes(c.suit))) throw new Error('Expected five to seven distinct cards');
 let best: PokerRank | undefined;
 for (let a = 0; a < cards.length - 4; a++) for (let b = a + 1; b < cards.length - 3; b++) for (let c = b + 1; c < cards.length - 2; c++) for (let d = c + 1; d < cards.length - 1; d++) for (let e = d + 1; e < cards.length; e++) {
  const candidate = five([cards[a], cards[b], cards[c], cards[d], cards[e]]);
  if (!best || comparePokerRanks(candidate, best) > 0) best = candidate;
 }
 return best!;
}
/** First card is drawn first. Production uses a fresh independent crypto Fisher-Yates shuffle each hand. */
export function pokerDeck(random: Random = cryptoRandom): Card[] {
 const deck = (['clubs', 'diamonds', 'hearts', 'spades'] as const).flatMap(suit => ranks.map(rank => ({ rank, suit })));
 for (let i = deck.length - 1; i > 0; i--) { const j = random(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
 return deck;
}
export type PokerContributor = { seat: number; committed: number; folded: boolean; cards: Card[] };
/** Separate contribution layers preserve side-pot eligibility. Uncalled excess is returned even to a folded contributor. */
export function pokerPots(players: readonly PokerContributor[], board: Card[], button: number): { pots: PokerPot[]; winners: PokerWinner[]; returns: Map<number, number>; refunds: Map<number, number> } {
 const levels = [...new Set(players.map(p => p.committed).filter(n => n > 0))].sort((a, b) => a - b);
 const returns = new Map<number, number>(), refunds = new Map<number, number>(), awards = new Map<number, number>(), pots: PokerPot[] = [], names = new Map<number, string>(); let previous = 0;
 for (const level of levels) {
  const contributors = players.filter(p => p.committed >= level), amount = (level - previous) * contributors.length; previous = level;
  if (contributors.length === 1) {
   const seat = contributors[0].seat;
   refunds.set(seat, (refunds.get(seat) ?? 0) + amount);
   returns.set(seat, (returns.get(seat) ?? 0) + amount);
   continue;
  }
  const eligible = contributors.filter(p => !p.folded);
  if (!eligible.length) throw new Error('Pot has no eligible player');
  let winners = eligible;
  if (eligible.length > 1) {
   const ranked = eligible.map(p => ({ player: p, rank: rankPoker([...p.cards, ...board]) }));
   const best = ranked.reduce((a, b) => comparePokerRanks(a.rank, b.rank) >= 0 ? a : b).rank;
   winners = ranked.filter(p => comparePokerRanks(p.rank, best) === 0).map(p => p.player);
   for (const p of winners) names.set(p.seat, best.name);
  } else names.set(eligible[0].seat, board.length === 5 ? rankPoker([...eligible[0].cards, ...board]).name : 'Uncontested');
  winners.sort((a, b) => (a.seat - button + 5) % 6 - (b.seat - button + 5) % 6);
  const base = Math.floor(amount / winners.length), odd = amount % winners.length;
  winners.forEach((p, i) => { const amount = base + (i < odd ? 1 : 0); returns.set(p.seat, (returns.get(p.seat) ?? 0) + amount); awards.set(p.seat, (awards.get(p.seat) ?? 0) + amount); });
  pots.push({ amount, eligibleSeats: eligible.map(p => p.seat), winnerSeats: winners.map(p => p.seat) });
 }
 return { pots, returns, refunds, winners: [...awards].map(([seat, amount]) => ({ seat, amount, hand: names.get(seat)! })) };
}
