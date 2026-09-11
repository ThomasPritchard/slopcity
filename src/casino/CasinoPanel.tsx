import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  CASINO_ANCHORS, CASINO_MAX_STAKE, CASINO_MIN_STAKE, CASINO_STAKE_STEP,
  BLACKJACK_BETTING_MS, BLACKJACK_ACTION_MS, ROULETTE_BETTING_MS,
  ROULETTE_PROFIT_MULTIPLIER, SLOT_PAYTABLE, SLOT_SYMBOLS, SLOTS_SPIN_MS,
  type BlackjackHandView, type BlackjackView, type Card, type CasinoCommand,
  type CasinoPrivateState, type CasinoTableView, type RouletteBetKind, type RouletteView,
  type SlotsView, type SlotSymbol,
} from '../../shared/casino';
import { isRed, rouletteChoices, rouletteCoverageLabel, rouletteKinds } from './rouletteChoices';
import { PokerGame } from './PokerGame';
import { CrapsGame } from './CrapsGame';
import './casino.css';

export interface CasinoPanelProps {
  open: boolean;
  table: CasinoTableView | null;
  /** The timestamp delivered with the latest authoritative table state. */
  serverTime: number;
  profileId: string;
  balance: number;
  privateState: CasinoPrivateState;
  busy: boolean;
  error: string;
  notice: string;
  onCommand(command: CasinoCommand): void;
  onClose(): void;
}

type WithoutRequestId<T> = T extends { requestId: string } ? Omit<T, 'requestId'> : never;
type Send = (command: WithoutRequestId<CasinoCommand>) => void;
const credits = (value: number) => value.toLocaleString('en-GB');
const suitGlyph: Record<Card['suit'], string> = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };
const compactControlsQuery = '(max-width: 699px) and (orientation: portrait), (max-height: 620px) and (orientation: landscape)';

function useCompactControls() {
  const [compact, setCompact] = useState(() => window.matchMedia(compactControlsQuery).matches);
  useEffect(() => {
    const media = window.matchMedia(compactControlsQuery);
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}

/** One set of controls: in the page flow on desktop, below the scroll area on phones. */
function ActionDock({ host, summary, children }: { host: HTMLElement | null; summary: ReactNode; children: ReactNode }) {
  return host ? createPortal(<div className="casino-action-dock"><div className="casino-dock-summary">{summary}</div><div className="casino-dock-controls">{children}</div></div>, host) : <>{children}</>;
}

function useServerNow(open: boolean, serverTime: number) {
  const anchor = useRef({ serverTime, receivedAt: performance.now() });
  const [now, setNow] = useState(serverTime);
  useEffect(() => {
    anchor.current = { serverTime, receivedAt: performance.now() };
    setNow(serverTime);
  }, [serverTime]);
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(anchor.current.serverTime + performance.now() - anchor.current.receivedAt), 100);
    return () => window.clearInterval(timer);
  }, [open]);
  return now;
}

function CloseIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>;
}

function StakeControl({ value, onChange, disabled, label = 'Your stake' }: { value: number; onChange(value: number): void; disabled: boolean; label?: string }) {
  const labelId = useId();
  return <div className="casino-stake">
    <span id={labelId} className="casino-label">{label}</span>
    <div role="group" aria-labelledby={labelId}>
      <button type="button" aria-label="Decrease stake" onClick={() => onChange(Math.max(CASINO_MIN_STAKE, value - CASINO_STAKE_STEP))} disabled={disabled || value <= CASINO_MIN_STAKE}>−</button>
      <output aria-live="polite">{value}<span>credits</span></output>
      <button type="button" aria-label="Increase stake" onClick={() => onChange(Math.min(CASINO_MAX_STAKE, value + CASINO_STAKE_STEP))} disabled={disabled || value >= CASINO_MAX_STAKE}>+</button>
    </div>
    <span className="casino-stake-range">{CASINO_MIN_STAKE}–{CASINO_MAX_STAKE} · steps of {CASINO_STAKE_STEP}</span>
  </div>;
}

function RoundStatus({ label, deadline, now, waiting }: { label: string; deadline: number; now: number; waiting?: boolean }) {
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  return <div className="casino-round-status"><span><i aria-hidden="true" />{label}</span>{deadline > 0 && !waiting && <span className="casino-countdown" aria-label={remaining ? `${remaining} seconds remaining` : 'Waiting for the table'}>{remaining ? `${remaining}s` : 'Settling…'}</span>}</div>;
}

function Roulette({ table, now, balance, privateState, busy, send, actionHost }: { table: RouletteView; now: number; balance: number; privateState: CasinoPrivateState; busy: boolean; send: Send; actionHost: HTMLElement | null }) {
  const [stake, setStake] = useState(CASINO_MIN_STAKE);
  const [kind, setKind] = useState<RouletteBetKind>('straight');
  const [choiceIndex, setChoiceIndex] = useState(0);
  const kindId = useId(), coverageId = useId();
  const choices = rouletteChoices(kind);
  const selectedNumbers = choices[choiceIndex] ?? choices[0];
  const acceptedBets = privateState.rouletteBets.filter(bet => bet.tableId === table.id && bet.roundId === table.roundId);
  const acceptedTotal = acceptedBets.reduce((sum, item) => sum + item.bet.stake, 0);
  const returned = table.phase === 'result' && table.result !== null ? acceptedBets.reduce((sum, item) => sum + (item.bet.numbers.includes(table.result!) ? item.bet.stake * (ROULETTE_PROFIT_MULTIPLIER[item.bet.kind] + 1) : 0), 0) : null;
  const betting = table.phase === 'betting' && now < table.deadline;
  const moving = table.phase === 'spinning' || table.phase === 'landing';
  const grossReturn = stake * (ROULETTE_PROFIT_MULTIPLIER[kind] + 1);

  function chooseKind(next: RouletteBetKind) { setKind(next); setChoiceIndex(0); }
  function chooseNumber(number: number) { setKind('straight'); setChoiceIndex(number); }

  return <>
    <RoundStatus label={table.phase === 'betting' ? 'Place your bets' : table.phase === 'spinning' ? 'No more bets' : table.phase === 'landing' ? 'Ball settling' : table.phase === 'result' ? 'The result is in' : 'Table paused'} deadline={table.deadline} now={now} waiting={table.phase === 'paused'} />
    <div className={`roulette-outcome ${moving ? 'is-spinning' : ''}`}>
      <div className="roulette-wheel-mark" aria-hidden="true"><span />✦</div>
      <div><span className="casino-label">{table.phase === 'result' ? 'WINNING NUMBER' : table.phase === 'landing' ? 'THE BALL IS SETTLING' : table.phase === 'spinning' ? 'THE WHEEL IS TURNING' : 'EUROPEAN · SINGLE ZERO'}</span>
        <strong>{table.phase === 'result' && table.result !== null ? <><span className={`roulette-winning-number ${table.result === 0 ? 'is-zero' : isRed(table.result) ? 'is-red' : 'is-black'}`}>{table.result}</span> {table.result === 0 ? 'Zero' : isRed(table.result) ? 'Red' : 'Black'}</> : table.phase === 'landing' ? 'Watch the ball.' : table.phase === 'spinning' ? 'A little suspense.' : 'Make your choice.'}</strong>
        <p>{returned !== null && acceptedBets.length ? `${credits(returned)} credits returned · ${credits(acceptedTotal)} staked` : `${table.betCount} ${table.betCount === 1 ? 'bet' : 'bets'} on the table`}</p>
      </div>
    </div>

    <details className="roulette-number-picker" open={!actionHost}>
    <summary>Choose on the number board <span aria-hidden="true">+</span></summary>
    <div className="roulette-number-heading"><span className="casino-label">PICK A SINGLE NUMBER</span><span>35:1 profit</span></div>
    <div className="roulette-number-board" role="group" aria-label="Roulette numbers">
      {Array.from({ length: 37 }, (_, number) => <button type="button" key={number} className={number === 0 ? 'is-zero' : isRed(number) ? 'is-red' : 'is-black'} aria-label={`${number}${number === 0 ? ', zero' : isRed(number) ? ', red' : ', black'}`} aria-pressed={selectedNumbers.includes(number)} disabled={busy || !betting} onClick={() => chooseNumber(number)}>{number}</button>)}
    </div>
    <div className="roulette-outside-bets" role="group" aria-label="Outside bets">
      {(['low', 'even', 'red', 'black', 'odd', 'high'] as const).map(option => <button type="button" key={option} className={option === 'red' ? 'is-red' : option === 'black' ? 'is-black' : ''} aria-pressed={kind === option} disabled={busy || !betting} onClick={() => chooseKind(option)}>{option === 'low' ? '1–18' : option === 'high' ? '19–36' : option[0].toUpperCase() + option.slice(1)}</button>)}
    </div>
    </details>

    <div className="roulette-bet-composer">
      <div className="casino-fields"><label htmlFor={kindId}>Bet type<select id={kindId} value={kind} disabled={busy || !betting} onChange={event => chooseKind(event.target.value as RouletteBetKind)}>{rouletteKinds.map(option => <option key={option.kind} value={option.kind}>{option.label}</option>)}</select></label>
        <label htmlFor={coverageId}>Covered numbers<select id={coverageId} value={choiceIndex} disabled={busy || !betting || choices.length === 1} onChange={event => setChoiceIndex(Number(event.target.value))}>{choices.map((numbers, index) => <option key={numbers.join('-')} value={index}>{rouletteCoverageLabel(kind, numbers)}</option>)}</select></label>
      </div>
      <ActionDock host={actionHost} summary={<><span className="casino-dock-selection">{rouletteCoverageLabel(kind, selectedNumbers)}<small>{rouletteKinds.find(option => option.kind === kind)?.label}</small></span><span className="casino-dock-return">{credits(grossReturn)} return if it wins<small>Includes your stake</small></span></>}>
        <StakeControl value={stake} onChange={setStake} disabled={busy || !betting} />
        {!actionHost && <div className="casino-return-line"><span>Return if it wins <small>including stake</small></span><strong>{credits(grossReturn)} credits</strong></div>}
        <button type="button" className="casino-primary" disabled={busy || !betting || balance < stake} onClick={() => send({ action: 'roulette-bet', tableId: table.id, roundId: table.roundId, bet: { kind, numbers: selectedNumbers, stake } })}>{busy ? 'Placing bet…' : !betting ? 'Betting is closed' : balance < stake ? 'Not enough credits' : `Place ${stake}-credit bet`}</button>
      </ActionDock>
      <p className="casino-fine">Each press places a separate bet. Accepted bets cannot be removed.</p>
    </div>

    <section className="casino-your-bets" aria-labelledby="roulette-your-bets"><div className="casino-section-heading"><h3 id="roulette-your-bets">Your bets this round</h3><span>{credits(acceptedTotal)} staked</span></div>
      {acceptedBets.length ? <ul>{acceptedBets.map(({ wagerId, bet }) => <li key={wagerId}><span>{rouletteKinds.find(option => option.kind === bet.kind)?.label}<small>{rouletteCoverageLabel(bet.kind, bet.numbers)}</small></span><strong>{bet.stake}</strong></li>)}</ul> : <p className="casino-muted">Your accepted bets will appear here.</p>}
    </section>
    {table.history.length > 0 && <section className="roulette-history" aria-label="Previous winning numbers"><span className="casino-label">RECENT RESULTS</span><ol>{table.history.map((number, index) => <li key={`${index}-${number}`} className={number === 0 ? 'is-zero' : isRed(number) ? 'is-red' : 'is-black'}>{number}</li>)}</ol></section>}
    <CasinoRules game="roulette" />
  </>;
}

function PlayingCard({ card }: { card: Card | null }) {
  if (!card) return <span className="casino-card is-hidden" aria-label="Face-down card"><span aria-hidden="true">M</span></span>;
  return <span className={`casino-card${card.suit === 'hearts' || card.suit === 'diamonds' ? ' is-red-card' : ''}`} aria-label={`${card.rank} of ${card.suit}`}><span aria-hidden="true">{card.rank}<small>{suitGlyph[card.suit]}</small></span><i aria-hidden="true">{suitGlyph[card.suit]}</i></span>;
}

function BlackjackHand({ hand, active, index, multiple }: { hand: BlackjackHandView; active: boolean; index: number; multiple: boolean }) {
  return <div className={`blackjack-hand${active ? ' is-active' : ''}`}>
    <div className="blackjack-hand-heading"><span>{multiple ? `Hand ${index + 1}` : 'Hand'}{active ? ' · playing' : ''}</span>{hand.cards.length > 0 && <strong>{hand.soft ? 'Soft ' : ''}{hand.total}</strong>}</div>
    <div className="casino-cards">{hand.cards.length ? hand.cards.map((card, cardIndex) => <PlayingCard key={cardIndex} card={card} />) : <p className="casino-muted">Cards are dealt when betting closes.</p>}</div>
    <p className="blackjack-hand-outcome">{hand.outcome === 'blackjack' ? 'Blackjack' : hand.outcome === 'win' ? 'Win' : hand.outcome === 'lose' ? 'Lost' : hand.outcome === 'push' ? 'Push' : hand.state === 'bust' ? 'Bust' : hand.state === 'stood' ? 'Standing' : hand.state === 'blackjack' ? 'Blackjack' : `${hand.stake} staked`}{(hand.returned ?? 0) > 0 && <strong>{credits(hand.returned ?? 0)} returned</strong>}</p>
  </div>;
}

function Blackjack({ table, now, profileId, balance, busy, send, actionHost }: { table: BlackjackView; now: number; profileId: string; balance: number; busy: boolean; send: Send; actionHost: HTMLElement | null }) {
  const [stake, setStake] = useState(CASINO_MIN_STAKE);
  const ownHands = useRef<HTMLDivElement>(null);
  const ownSeat = table.seats.find(seat => seat.player.profileId === profileId);
  const leavePending = !!ownSeat && !ownSeat.player.connected && ownSeat.hands.length > 0;
  const activeSeat = table.seats.find(seat => seat.seat === table.activeSeat);
  const betting = table.phase === 'betting' && now < table.deadline;
  const yourTurn = table.phase === 'playing' && table.activeSeat === ownSeat?.seat && now < table.deadline;
  const activeHand = yourTurn && table.activeHand !== null ? ownSeat?.hands[table.activeHand] : undefined;
  const label = table.phase === 'betting' ? 'Bets open' : table.phase === 'playing' ? yourTurn ? 'Your turn' : `${activeSeat?.player.name ?? 'Player'}’s turn` : table.phase === 'dealer' ? 'Dealer’s hand' : table.phase === 'result' ? 'Round complete' : 'Table paused';
  useEffect(() => {
    if (actionHost && yourTurn) ownHands.current?.scrollIntoView({ block: 'nearest' });
  }, [actionHost, yourTurn, table.activeHand]);
  const leaveButton = <button type="button" className="casino-text-button" disabled={busy || leavePending || !ownSeat?.player.connected} onClick={() => send({ action: 'leave', tableId: table.id })}>{leavePending ? 'Leaving…' : ownSeat?.player.connected ? 'Leave seat' : 'Seat inactive'}</button>;
  const actionSummary = <><span>{yourTurn && activeHand ? `Your turn · ${activeHand.soft ? 'soft ' : ''}${activeHand.total}` : label}<small>{yourTurn && ownSeat && ownSeat.hands.length > 1 ? `Hand ${(table.activeHand ?? 0) + 1} · ` : ''}{table.deadline > now ? `${Math.ceil((table.deadline - now) / 1000)}s remaining` : 'Waiting for the table'}</small></span>{leaveButton}</>;
  const wagerControls = <><StakeControl value={stake} onChange={setStake} disabled={busy} /><button type="button" className="casino-primary" disabled={busy || balance < stake} onClick={() => send({ action: 'blackjack-bet', tableId: table.id, roundId: table.roundId, stake })}>{busy ? 'Placing bet…' : balance < stake ? 'Not enough credits' : `Bet ${stake} credits`}</button></>;
  const handControls = activeHand && <div className="blackjack-actions" role="group" aria-label="Your available actions">{(['hit', 'stand', 'double', 'split'] as const).map(move => <button key={move} type="button" className={move === 'hit' ? 'casino-primary' : 'casino-secondary'} disabled={busy || !activeHand.actions.includes(move) || ((move === 'double' || move === 'split') && balance < activeHand.stake)} onClick={() => send({ action: 'blackjack-action', tableId: table.id, roundId: table.roundId, hand: table.activeHand!, move })}>{move === 'double' ? `Double · +${activeHand.stake}` : move === 'split' ? `Split · +${activeHand.stake}` : move[0].toUpperCase() + move.slice(1)}</button>)}</div>;

  return <>
    <RoundStatus label={label} deadline={table.deadline} now={now} waiting={table.phase === 'paused'} />
    <section className="blackjack-dealer" aria-label="Dealer hand"><div className="casino-section-heading"><h3>Dealer</h3><span>{table.dealerTotal !== null ? `Total ${table.dealerTotal}` : table.dealer.length ? 'One card concealed' : 'Waiting for bets'}</span></div>
      <div className="casino-cards">{table.dealer.length ? table.dealer.map((card, index) => <PlayingCard key={index} card={card} />) : <><PlayingCard card={null} /><PlayingCard card={null} /></>}</div>
      <p className="casino-fine">Blackjack pays 3:2 · dealer stands on all 17s</p>
    </section>

    <div className={`casino-section-heading blackjack-seat-heading${ownSeat ? ' has-own-seat' : ''}`}><h3>At the table</h3><span>{table.seats.length} / 5 seated</span></div>
    <ActionDock host={ownSeat ? null : actionHost} summary={<><span>Take a seat to play</span><span>{table.seats.length} / 5 seated</span></>}>
    <div className={`blackjack-seats${ownSeat ? ' has-own-seat' : ''}`} role="group" aria-label="Blackjack seats">
      {Array.from({ length: 5 }, (_, seatNumber) => {
        const seat = table.seats.find(entry => entry.seat === seatNumber);
        return seat ? <div key={seatNumber} className={`blackjack-seat${seat.player.profileId === profileId ? ' is-yours' : ''}${table.activeSeat === seatNumber ? ' is-active' : ''}`}><span className="blackjack-seat-number">{String(seatNumber + 1).padStart(2, '0')}</span><strong>{seat.player.profileId === profileId ? 'You' : seat.player.name}</strong><small>{!seat.player.connected ? 'Away' : table.phase === 'result' && seat.hands.length ? 'Round complete' : table.activeSeat === seatNumber ? 'Playing' : seat.hands.length ? 'Bet placed' : 'Seated'}</small></div>
          : <button key={seatNumber} type="button" className="blackjack-seat is-empty" disabled={busy || !!ownSeat || table.phase === 'paused'} onClick={() => send({ action: 'blackjack-join', tableId: table.id, seat: seatNumber })} aria-label={`Take seat ${seatNumber + 1}`}><span className="blackjack-seat-number">{String(seatNumber + 1).padStart(2, '0')}</span><strong>Join</strong><small>Open seat</small></button>;
      })}
    </div>
    </ActionDock>

    {ownSeat ? <section className="blackjack-player-controls" aria-label="Your blackjack controls">
      <div className="casino-section-heading"><h3>Your place</h3>{!actionHost && leaveButton}</div>
      {leavePending && <p className="casino-muted" role="status">Leaving after this hand settles…</p>}
      {ownSeat.hands.length === 0 && betting && !actionHost ? wagerControls : null}
      {ownSeat.hands.length === 0 && !betting && <p className="casino-muted">You have a seat. Betting opens with the next round.</p>}
      {ownSeat.hands.length > 0 && <div ref={ownHands} className={`blackjack-hands${ownSeat.hands.length > 1 ? ' is-split' : ''}`}>{ownSeat.hands.map((hand, index) => <BlackjackHand key={index} hand={hand} index={index} multiple={ownSeat.hands.length > 1} active={yourTurn && table.activeHand === index} />)}</div>}
      {!actionHost && handControls}
      {actionHost && <ActionDock host={actionHost} summary={actionSummary}>{ownSeat.hands.length === 0 && betting ? wagerControls : handControls || <p className="casino-dock-waiting">{ownSeat.hands.length && betting ? `${ownSeat.hands[0].stake} credits placed. Waiting for the deal.` : table.phase === 'result' ? 'Round complete. The next hand starts shortly.' : 'Your accepted bets remain in play.'}</p>}</ActionDock>}
      <p className="casino-fine">{yourTurn ? 'Choose before the timer ends. An expired turn stands automatically.' : ownSeat.hands.length && betting ? 'Your bet is placed. Cards are dealt when betting closes.' : 'Leaving keeps accepted bets in play and stands any remaining hands.'}</p>
    </section> : <p className="casino-spectator-note">Watching the table. Take an open seat to play.</p>}

    {table.seats.some(seat => seat.player.profileId !== profileId && seat.hands.length > 0) && <section className="blackjack-other-hands" aria-label="Other players’ hands">{table.seats.filter(seat => seat.player.profileId !== profileId && seat.hands.length > 0).map(seat => <div key={seat.seat}><div className="casino-section-heading"><h3>{seat.player.name}</h3><span>Seat {seat.seat + 1}</span></div><div className={`blackjack-hands${seat.hands.length > 1 ? ' is-split' : ''}`}>{seat.hands.map((hand, index) => <BlackjackHand key={index} hand={hand} index={index} multiple={seat.hands.length > 1} active={table.activeSeat === seat.seat && table.activeHand === index} />)}</div></div>)}</section>}
    <CasinoRules game="blackjack" />
  </>;
}

function SlotMark({ symbol }: { symbol: SlotSymbol }) {
  return <svg viewBox="0 0 80 88" className={`slot-symbol slot-symbol-${symbol}`} role="img" aria-label={symbol}>
    {symbol === 'cherry' ? <><path d="M22 54C22 34 46 40 51 17M50 18c0 15 8 26 8 39" fill="none" stroke="#486145" strokeWidth="4" strokeLinecap="round" /><path d="M48 25c-15 2-18-8-17-13 12-1 19 3 17 13Z" fill="#697b43"/><circle cx="24" cy="59" r="15" fill="#a33f3c"/><circle cx="57" cy="61" r="15" fill="#b74d45"/><path d="M17 53c1-3 3-4 6-4M50 55c1-3 3-4 6-4" fill="none" stroke="#e5957c" strokeWidth="3" strokeLinecap="round" /></> : symbol === 'lemon' ? <><path d="M13 52C9 32 32 15 52 23l12-3-1 12c13 23-11 45-32 36l-12 3 1-10Z" fill="#e0bc58" stroke="#ba933b" strokeWidth="2"/><path d="M24 40c6-9 13-11 23-9" fill="none" stroke="#f7e3a3" strokeWidth="3" strokeLinecap="round"/><path d="M48 21c3-12 11-15 20-10-2 10-8 15-20 10Z" fill="#64784a" /></> : symbol === 'bar' ? <><rect x="7" y="27" width="66" height="35" rx="4" fill="#253e34"/><rect x="11" y="31" width="58" height="27" rx="2" fill="none" stroke="#cbb781"/><text x="40" y="50" textAnchor="middle" fill="#f1e5bc" fontFamily="Georgia, serif" fontSize="23" fontWeight="bold">BAR</text></> : <><path d="M16 20h49v12L41 72H24l24-39H16Z" fill="#a4483d" stroke="#75332f" strokeWidth="2"/><path d="M20 24h40" stroke="#e39370" strokeWidth="3" strokeLinecap="round"/></>}
  </svg>;
}

function Slots({ table, now, profileId, balance, busy, send, actionHost }: { table: SlotsView; now: number; profileId: string; balance: number; busy: boolean; send: Send; actionHost: HTMLElement | null }) {
  const [stake, setStake] = useState(CASINO_MIN_STAKE);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);
  const spinning = table.phase === 'spinning';
  const remaining = Math.max(0, table.deadline - now);
  const isOwner = table.player?.profileId === profileId;
  const available = table.phase === 'idle';
  const displayReels = spinning ? Array.from({ length: 3 }, (_, index) => SLOT_SYMBOLS[(Math.floor(Math.max(0, SLOTS_SPIN_MS - remaining) / 95) + index) % SLOT_SYMBOLS.length]) : table.reels;
  return <>
    <RoundStatus label={spinning ? isOwner ? 'Your reels are spinning' : `${table.player?.name ?? 'Someone'} is playing` : table.phase === 'paused' ? 'Machine paused' : table.phase === 'result' ? 'Next spin shortly' : 'Ready when you are'} deadline={table.deadline} now={now} waiting={table.phase === 'idle' || table.phase === 'paused'} />
    <div className={`slots-machine${spinning && remaining > 0 ? ' is-spinning' : ''}`}>
      <span className="slots-machine-brand">MERIDIAN</span><h3>A turn of fortune.</h3><div className="slots-reels" role="group" aria-label={spinning ? 'Reels spinning' : 'Reel result'} aria-live="off">{Array.from({ length: 3 }, (_, index) => <div className="slot-reel" key={index} aria-hidden={spinning}>{spinning && (reducedMotion || remaining === 0) ? <span className="slot-waiting-mark">M</span> : <SlotMark symbol={displayReels[index] ?? SLOT_SYMBOLS[index]} />}</div>)}</div>
      <div className="slots-result" role="status">{spinning ? <><strong>{remaining > 0 ? 'Spinning…' : 'Waiting for the result…'}</strong><span>{table.stake} credits staked</span></> : table.phase === 'result' && table.returned !== null ? <><strong>{table.returned > table.stake ? `${credits(table.returned)} credits returned` : table.returned === table.stake ? 'Stake returned' : 'No winning line'}</strong><span>{isOwner ? 'Your spin' : `${table.player?.name ?? 'Previous player'}’s spin`} · {table.stake} credits staked</span></> : <><strong>Three reels. One line.</strong><span>Choose your stake, then take a spin.</span></>}</div>
    </div>
    <ActionDock host={actionHost} summary={<><span>{spinning ? 'Reels are spinning' : table.phase === 'result' && table.returned !== null ? `${credits(table.returned)} credits returned` : 'One spin at a time'}</span><span>{spinning ? `${Math.ceil(remaining / 1000)}s` : table.phase === 'result' ? 'Next spin shortly' : `${CASINO_MIN_STAKE}–${CASINO_MAX_STAKE} credits`}</span></>}>
      <StakeControl value={stake} onChange={setStake} disabled={busy || !available} />
      <button type="button" className="casino-primary" disabled={busy || !available || balance < stake} onClick={() => send({ action: 'slots-spin', tableId: table.id, stake })}>{busy ? 'Starting spin…' : spinning ? 'Spin in progress' : table.phase === 'paused' ? 'Machine paused' : table.phase === 'result' ? 'Next spin shortly' : balance < stake ? 'Not enough credits' : `Spin for ${stake} credits`}</button>
    </ActionDock>
    <p className="casino-fine">One spin per press. The machine is shared; wait for its current spin to finish.</p>
    <section className="slots-paytable" aria-labelledby="slots-paytable"><div className="casino-section-heading"><h3 id="slots-paytable">The paytable</h3><span>Return includes stake</span></div><table><caption className="sr-only">Slot combinations and credit returns at your selected stake</caption><thead><tr><th scope="col">Winning line</th><th scope="col">Return</th></tr></thead><tbody>{SLOT_PAYTABLE.map(row => <tr key={row.label}><th scope="row"><span className="slots-paytable-symbols" aria-hidden="true">{Array.from({ length: row.count }, (_, index) => <SlotMark key={index} symbol={row.symbol}/>)}</span><span>{row.label}</span></th><td><strong>{credits(row.multiplier * stake)}</strong><small>{row.multiplier}× stake</small></td></tr>)}</tbody></table></section>
    <CasinoRules game="slots" />
  </>;
}

function CasinoRules({ game }: { game: CasinoTableView['game'] }) {
  return <details className="casino-rules"><summary>Rules & returns <span aria-hidden="true">+</span></summary>
    {game === 'roulette' ? <><p>A European wheel has 37 equally likely numbers: 0–36. Betting stays open for {ROULETTE_BETTING_MS / 1000} seconds. Every accepted bet is final and remains in play if you close the table. Each player can place up to 20 bets and stake up to 1,000 credits per round.</p><p>Profit odds: single number 35:1; split 17:1; street or zero trio 11:1; corner or first four 8:1; six line 5:1; dozen or column 2:1; red, black, odd, even, low or high 1:1. A winning return also includes the original stake.</p><p>Zero wins only bets that explicitly cover it. Red, black, odd, even, low, high, dozens and columns all lose on zero. Previous results do not change the next spin’s chances.</p></> : game === 'blackjack' ? <><p>Each round uses a freshly shuffled six-deck shoe. Get closer to 21 than the dealer without going over. Face cards count as 10; an ace counts as 1 or 11. The dealer stands on every 17, including soft 17, and checks for blackjack when showing an ace or ten-value card.</p><p>A natural blackjack pays 3:2 profit. Other wins pay 1:1; a push returns your stake. Returns shown include the stake. Betting lasts {BLACKJACK_BETTING_MS / 1000} seconds, with {BLACKJACK_ACTION_MS / 1000} seconds for each turn.</p><p>Double on the first two cards: add a matching stake and receive exactly one more card. Split once when both cards have the same rank, adding a matching stake. Split aces receive one card each; 21 after a split pays as an ordinary win. No insurance or surrender.</p><p>The table shows the actions available for your hand. Expired turns stand automatically. Leaving keeps accepted bets in play and stands your remaining hands.</p></> : <><p>Each spin stops three independent reels on one line. Three matching symbols pay the listed return. Exactly two cherries anywhere return the stake; only the highest matching paytable entry pays.</p><p>On each reel, cherries have a 7-in-16 chance, lemons 4-in-16, bars 3-in-16 and sevens 2-in-16. All other combinations pay zero. The paytable shows the total returned at your selected stake, including the original stake.</p><p>Spins take about {SLOTS_SPIN_MS / 1000} seconds. An accepted spin finishes if you close the machine. There is no autoplay.</p></>}
    <p>All stakes use fictional city credits. There is no real-money play, purchase or cash-out.</p>
  </details>;
}

export function CasinoPanel({ open, table, serverTime, profileId, balance, privateState, busy, error, notice, onCommand, onClose }: CasinoPanelProps) {
  const panel = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const closeAction = useRef(onClose);
  const titleId = useId();
  const now = useServerNow(open, serverTime);
  const compactControls = useCompactControls();
  const [actionContainer, setActionContainer] = useState<HTMLDivElement | null>(null);
  const actionHost = compactControls ? actionContainer : null;
  useEffect(() => { closeAction.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    closeButton.current?.focus({ preventScroll: true });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); closeAction.current();
      } else if (event.key === 'Tab' && panel.current) {
        const controls = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), summary, [tabindex="0"]')].filter(control => control.getClientRects().length > 0);
        const first = controls[0], last = controls[controls.length - 1];
        const outside = !panel.current.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      const target = previousFocus instanceof HTMLElement && previousFocus.isConnected ? previousFocus : document.getElementById('world');
      target?.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  const send: Send = command => { if (!busy) onCommand({ ...command, requestId: crypto.randomUUID() } as CasinoCommand); };
  const name = table ? CASINO_ANCHORS.find(anchor => anchor.id === table.id)?.name ?? 'Meridian Casino' : 'Meridian Casino';
  return <div className="casino-overlay"><section ref={panel} className="casino-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <header className="casino-header"><div><span className="eyebrow">THE MERIDIAN CASINO</span><h2 id={titleId}>{name}</h2></div><button ref={closeButton} type="button" className="casino-close" aria-label="Close casino table" onClick={onClose}><CloseIcon /></button><div className="casino-wallet"><span>Your credits</span><strong aria-label="Casino credit balance">{credits(balance)}</strong><span className="casino-fictional">FICTIONAL CURRENCY</span></div></header>
    <div className="casino-body" key={table?.id ?? 'loading'}>{!table ? <p className="casino-muted" role="status">Connecting to the table…</p> : table.game === 'roulette' ? <Roulette table={table} now={now} balance={balance} privateState={privateState} busy={busy} send={send} actionHost={actionHost} /> : table.game === 'blackjack' ? <Blackjack table={table} now={now} profileId={profileId} balance={balance} busy={busy} send={send} actionHost={actionHost} /> : table.game === 'craps' ? <CrapsGame table={table} now={now} profileId={profileId} balance={balance} privateState={privateState} busy={busy} send={send} actionHost={actionHost} /> : table.game === 'poker' ? <PokerGame table={table} now={now} profileId={profileId} balance={balance} privateState={privateState} busy={busy} send={send} actionHost={actionHost} /> : <Slots table={table} now={now} profileId={profileId} balance={balance} busy={busy} send={send} actionHost={actionHost} />}</div>
    <div ref={setActionContainer} className="casino-mobile-actions" />
    {(error || notice || busy) && <footer className="casino-feedback">{error ? <p className="casino-error" role="alert">{error}</p> : <p role="status">{busy ? 'Waiting for the table…' : notice}</p>}</footer>}
  </section><p className="casino-world-note" aria-hidden="true">THE MERIDIAN<span>Stay a while.</span></p></div>;
}
