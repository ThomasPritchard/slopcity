import { useEffect, useState, type ReactNode } from 'react';
import type { CasinoTableView } from '../../shared/casino';
import { BLACKJACK_ACTION_MS, BLACKJACK_BETTING_MS, ROULETTE_BETTING_MS, SLOT_PAYTABLE } from '../../shared/casino';
import { CRAPS_BETTING_MS, CRAPS_AWAITING_ROLL_MS } from '../../shared/craps';
import { POKER_TURN_MS, POKER_BUY_IN_STEP, POKER_MIN_BUY_IN, POKER_MAX_BUY_IN } from '../../shared/poker';

export type CasinoView = 'play' | 'rules' | 'results';
export function PageNav({ page, count, onChange, label = 'Page' }: { page: number; count: number; onChange(page: number): void; label?: string }) {
  return count > 1 ? <nav className="casino-page-nav" aria-label={`${label} pages`}><button type="button" aria-label={`Previous ${label.toLowerCase()} page`} disabled={page === 0} onClick={() => onChange(page - 1)}>←</button><span aria-live="polite">{label} {page + 1} / {count}</span><button type="button" aria-label={`Next ${label.toLowerCase()} page`} disabled={page >= count - 1} onClick={() => onChange(page + 1)}>→</button></nav> : null;
}
export function PagedItems<T>({ items, render, label, pageSize = 1 }: { items: T[]; render(item: T, index: number): ReactNode; label: string; pageSize?: number }) {
  const [choice, setChoice] = useState(0);
  const count = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(choice, count - 1);
  return <div className="casino-paged-items"><div className="casino-page-items">{items.slice(page * pageSize, (page + 1) * pageSize).map((item, index) => render(item, page * pageSize + index))}</div><PageNav page={page} count={count} onChange={setChoice} label={label} /></div>;
}
export function StageTabs<T extends string>({ value, onChange, options, label }: { value: T; onChange(value: T): void; options: readonly { value: T; label: string }[]; label: string }) {
  return <nav className="casino-stage-tabs" aria-label={label}>{options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}<select className="casino-stage-select" aria-label={label} value={value} onChange={event=>onChange(event.target.value as T)}>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></nav>;
}
export function useCompactPages() {
  const [short, setShort] = useState(() => window.matchMedia('(max-height: 620px) and (orientation: landscape), (max-width: 699px) and (max-height: 740px) and (orientation: portrait)').matches);
  useEffect(() => { const media = window.matchMedia('(max-height: 620px) and (orientation: landscape), (max-width: 699px) and (max-height: 740px) and (orientation: portrait)'); const change = () => setShort(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  return short;
}
const commonRule: [string, string] = ['City credits', 'All credits and chips are fictional. There is no real-money play, purchase or cash-out. Accepted bets finish even if you close the table.'];
const rules: Record<CasinoTableView['game'], [string, string][]> = {
  roulette: [
    ['Pick a colour or number', 'Choose a quick outside bet, a number, or More bets. Set your stake, then press Place bet. Every press adds a separate, final bet.'],
    ['Set your stake', 'Type an amount or use − / +. Stakes use 10-credit steps, limited by your balance and 1,000 credits across the round. Check the displayed amount before placing your bet.'],
    ['Ready for the spin', `Betting lasts up to ${ROULETTE_BETTING_MS / 1000} seconds. Once you have placed all your bets, press Ready. The table can start early when all players are ready. Limit: 20 bets and 1,000 credits each round.`],
    ['Outside returns', 'Red, black, odd, even, 1–18 and 19–36 pay 1:1 profit. Dozens and columns pay 2:1. A winning return also includes your original stake.'],
    ['Inside returns', 'A single number pays 35:1 profit; split 17:1; street or zero trio 11:1; corner or first four 8:1; six line 5:1. More bets shows every legal combination.'],
    ['Single zero', 'The wheel has 37 equally likely numbers, 0–36. Zero only wins bets that cover it explicitly. All outside bets lose on zero. Previous spins do not affect the next result.'], commonRule,
  ],
  blackjack: [
    ['Get close to 21', 'Take a seat, choose a stake and bet. Beat the dealer’s total without going over 21. Face cards count as 10; an ace is 1 or 11.'],
    ['Hit or stand', `Hit takes another card. Stand keeps your total. Your turn lasts ${BLACKJACK_ACTION_MS / 1000} seconds; if it expires, you stand. The current hand is highlighted and appears automatically.`],
    ['Double or split', 'Double adds a matching stake and one final card. Split equal ranks or any two ten-value cards (10, J, Q, K), adding a matching stake. Split once; split aces get one card each.'],
    ['Winning returns', 'Natural blackjack pays 3:2 profit. Other wins pay 1:1; a push returns your stake. A split 21 is an ordinary win. The dealer stands on all 17s, including soft 17. No insurance or surrender.'],
    ['At the table', `A fresh six-deck shoe is used each round. The dealer checks for blackjack with an ace or ten showing. Betting lasts up to ${BLACKJACK_BETTING_MS / 1000} seconds; all players can Ready to start early. Leaving stands remaining hands.`], commonRule,
  ],
  slots: [
    ['Take a spin', 'Choose a stake and press Spin. Three independent reels stop on one line. There is no autoplay. You can spin again as soon as your result is revealed; other players wait for the machine.'],
    ...SLOT_PAYTABLE.map((row): [string, string] => [row.label, `${row.label} returns ${row.multiplier}× your stake, including the original stake. ${row.count === 2 ? 'The two cherries can appear anywhere on the line.' : 'All three reels must match.'} Only the highest matching line pays.`]),
    ['Reel chances', 'Each reel has cherries 7 in 16, lemons 4 in 16, bars 3 in 16 and sevens 2 in 16. Combinations outside the paytable return zero.'], commonRule,
  ],
  craps: [
    ['Choose a line', `Pick Pass or Don’t Pass, then set your stake and bet. One bet per cycle. Betting lasts up to ${CRAPS_BETTING_MS / 1000} seconds; Ready can close it early when every player is ready.`],
    ['The opening roll', 'Pass wins on 7 or 11. Don’t Pass wins on 2 or 3. The other line loses. A 12 loses Pass and returns Don’t Pass’s stake. Any other total sets the point.'],
    ['Once a point is set', 'Pass wins if the point rolls again before 7. Don’t Pass wins if 7 rolls first. Other totals keep both lines in play. You cannot add or change a bet until this cycle ends.'],
    ['Roll the dice', `The first eligible bettor becomes shooter. The shooter presses Roll dice, or the table rolls after ${CRAPS_AWAITING_ROLL_MS / 1000} seconds. They keep the dice until seven out or leaving.`],
    ['Line returns', 'A winning line returns 2× the stake, including the original stake. A push returns the stake; a loss returns zero. Both lines stay in play while the point is unresolved.'], commonRule,
  ],
  poker: [
    ['Make the best five cards', 'Texas Hold’em needs two to six players. Use any combination of your two private cards and the five community cards to make the best five-card hand.'],
    ['Buy in and get ready', `Choose a seat and buy in for ${POKER_MIN_BUY_IN}–${POKER_MAX_BUY_IN.toLocaleString('en-GB')} credits, in steps of ${POKER_BUY_IN_STEP}. One credit becomes one table chip. Wallet credits and table chips are separate. At least two players are needed to start.`],
    ['Check, call or fold', `Check adds no chips. Call matches the displayed cost. Fold leaves this hand. Act within ${POKER_TURN_MS / 1000} seconds. Betting happens before the flop and after the flop, turn and river.`],
    ['Raise or go all-in', 'Raise opens an amount step. “Raise to” is your total for this betting round, including chips already bet. The allowed minimum and maximum are shown. All-in commits your remaining stack.'],
    ['Blinds and pots', 'Blinds are 5 / 10 chips. D is the dealer button, SB the small blind and BB the big blind. Extra bets beyond an all-in player’s contribution form side pots. Tied winners share each pot.'],
    ['Keep or return your chips', 'Winnings stay in your table stack. Leave between hands to return chips to your wallet. Leaving during play folds on your next turn; all-in hands and completed betting stay live until settlement.'], commonRule,
  ],
};
export function CasinoRules({ game }: { game: CasinoTableView['game'] }) {
  return <section className="casino-rule-pages" aria-label="How to play"><PagedItems key={game} items={rules[game]} label="Rules" render={([heading, text], index) => <article key={index}><span className="casino-label">HOW TO PLAY</span><h3>{heading}</h3><p>{text}</p></article>} /></section>;
}
