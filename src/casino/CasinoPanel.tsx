import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  CASINO_ANCHORS, CASINO_MAX_STAKE, CASINO_MIN_STAKE, CASINO_STAKE_STEP, ROULETTE_MAX_ROUND_STAKE, ROULETTE_MAX_BETS_PER_ROUND,
  ROULETTE_PROFIT_MULTIPLIER, SLOT_SYMBOLS, SLOTS_SPIN_MS,
  type BlackjackHandView, type BlackjackView, type Card, type CasinoCommand,
  type CasinoPrivateState, type CasinoTableView, type RouletteBetKind, type RouletteView,
  type SlotsView, type SlotSymbol,
} from '../../shared/casino';
import { isRed, rouletteChoices, rouletteCoverageLabel, rouletteKinds } from './rouletteChoices';
import { PokerGame } from './PokerGame';
import { CrapsGame } from './CrapsGame';
import { CasinoRules, PageNav, PagedItems, StageTabs, useCompactPages, type CasinoView } from './CasinoViews';
import { effectiveDeadline, RoundReady } from './RoundReady';
import { summariseCasinoResult, type CasinoResult } from './casinoResults';
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
  latestResult?: CasinoResult;
  chat?: ReactNode;
  onCommand(command: CasinoCommand): void;
  onClose(): void;
}

type WithoutRequestId<T> = T extends { requestId: string } ? Omit<T, 'requestId'> : never;
type Send = (command: WithoutRequestId<CasinoCommand>) => void;
const credits = (value: number) => value.toLocaleString('en-GB');
const suitGlyph: Record<Card['suit'], string> = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };
/** Actions remain available while the player reads another page. */
function ActionDock({ host, summary, children }: { host: HTMLElement | null; summary: ReactNode; children: ReactNode }) {
  const dock = <div className="casino-action-dock"><div className="casino-dock-summary">{summary}</div><div className="casino-dock-controls">{children}</div></div>;
  return host ? createPortal(dock, host) : dock;
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

function RouletteStake({ value, max, disabled, onChange }: { value: string; max: number; disabled: boolean; onChange(value: string): void }) {
  const amount = Number(value);
  return <div className="casino-stake roulette-stake"><div role="group" aria-label="Your stake">
    <button type="button" aria-label="Decrease stake" disabled={disabled || amount <= CASINO_MIN_STAKE} onClick={()=>onChange(String(Math.max(CASINO_MIN_STAKE, Math.floor(amount / CASINO_STAKE_STEP) * CASINO_STAKE_STEP - CASINO_STAKE_STEP)))}>−</button>
    <label><span className="sr-only">Roulette stake</span><input aria-label="Roulette stake" type="number" inputMode="numeric" min={CASINO_MIN_STAKE} max={Math.max(CASINO_MIN_STAKE,max)} step={CASINO_STAKE_STEP} value={value} disabled={disabled || max<CASINO_MIN_STAKE} onChange={event=>onChange(event.target.value)} aria-invalid={!Number.isSafeInteger(amount) || amount<CASINO_MIN_STAKE || amount>max || amount%CASINO_STAKE_STEP!==0}/><small>credits</small></label>
    <button type="button" aria-label="Increase stake" disabled={disabled || amount >= max} onClick={()=>onChange(String(Math.min(max, Math.max(CASINO_MIN_STAKE, Math.floor(amount / CASINO_STAKE_STEP) * CASINO_STAKE_STEP + CASINO_STAKE_STEP))))}>+</button>
  </div></div>;
}

function Roulette({ table, now, profileId, balance, privateState, busy, send, actionHost }: { table: RouletteView; now: number; profileId: string; balance: number; privateState: CasinoPrivateState; busy: boolean; send: Send; actionHost: HTMLElement | null }) {
  const [stakeValue, setStakeValue] = useState(String(CASINO_MIN_STAKE));
  const stake = Number(stakeValue);
  const validStake = Number.isSafeInteger(stake) && stake >= CASINO_MIN_STAKE && stake % CASINO_STAKE_STEP === 0;
  const [kind, setKind] = useState<RouletteBetKind>('red');
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [stage, setStage] = useState<'quick' | 'numbers' | 'more' | 'bets'>('quick');
  const [numberPage, setNumberPage] = useState(0);
  const short = useCompactPages();
  const kindId = useId(), coverageId = useId();
  const choices = rouletteChoices(kind);
  const selectedNumbers = choices[choiceIndex] ?? choices[0];
  const acceptedBets = privateState.rouletteBets.filter(bet => bet.tableId === table.id && bet.roundId === table.roundId);
  const acceptedTotal = acceptedBets.reduce((sum, item) => sum + item.bet.stake, 0);
  const deadline = effectiveDeadline(table);
  const betting = table.phase === 'betting' && now < deadline;
  const grossReturn = stake * (ROULETTE_PROFIT_MULTIPLIER[kind] + 1);
  const limited = acceptedBets.length >= ROULETTE_MAX_BETS_PER_ROUND || acceptedTotal + stake > ROULETTE_MAX_ROUND_STAKE;
  const perPage = short ? 6 : 12;
  const page = Math.min(numberPage, Math.ceil(37 / perPage) - 1);
  function chooseKind(next: RouletteBetKind) { setKind(next); setChoiceIndex(0); }
  return <div className="roulette-game casino-game">
    <RoundStatus label={table.phase === 'betting' ? 'Place your bets' : table.phase === 'spinning' ? 'No more bets · watch the wheel' : table.phase === 'landing' ? 'Ball settling' : table.phase === 'result' ? `Winning number: ${table.result} · ${table.result === 0 ? 'Zero' : isRed(table.result ?? 0) ? 'Red' : 'Black'}` : 'Table paused'} deadline={effectiveDeadline(table)} now={now} waiting={table.phase === 'paused'} />
    <StageTabs<typeof stage> value={stage} onChange={setStage} label="Roulette choices" options={[{value:'quick',label:'Quick bets'},{value:'numbers',label:'Numbers'},{value:'more',label:'More bets'},{value:'bets',label:`Your bets (${acceptedBets.length})`}]} />
    <div className="casino-stage">
      {stage === 'quick' ? <><p className="casino-instruction">Pick a colour or group, set your stake, then place your bet.</p><div className="roulette-outside-bets" role="group" aria-label="Outside bets">{(['red','black','odd','even','low','high'] as const).map(option => <button key={option} type="button" className={option === 'red' ? 'is-red' : option === 'black' ? 'is-black' : ''} aria-pressed={kind === option} disabled={busy || !betting} onClick={() => chooseKind(option)}>{option === 'low' ? '1–18' : option === 'high' ? '19–36' : option[0].toUpperCase()+option.slice(1)}</button>)}</div></>
      : stage === 'numbers' ? <><p className="casino-instruction">Choose one number. A win returns 36× your stake.</p><div className="roulette-number-board" role="group" aria-label="Roulette numbers">{Array.from({ length: Math.min(perPage, 37 - page * perPage) }, (_, index) => page * perPage + index).map(number => <button type="button" key={number} className={number === 0 ? 'is-zero' : isRed(number) ? 'is-red' : 'is-black'} aria-label={`${number}, ${number === 0 ? 'zero' : isRed(number) ? 'red' : 'black'}`} aria-pressed={kind === 'straight' && selectedNumbers[0] === number} disabled={busy || !betting} onClick={() => { setKind('straight'); setChoiceIndex(number); }}>{number}</button>)}</div><PageNav page={page} count={Math.ceil(37/perPage)} onChange={setNumberPage} label="Numbers" /></>
      : stage === 'more' ? <><p className="casino-instruction">Choose a bet type and its covered numbers. Return includes stake.</p><div className="casino-fields"><label htmlFor={kindId}>Bet type<select id={kindId} value={kind} disabled={busy || !betting} onChange={event => chooseKind(event.target.value as RouletteBetKind)}>{rouletteKinds.map(option => <option key={option.kind} value={option.kind}>{option.label}</option>)}</select></label><label htmlFor={coverageId}>Covered numbers<select id={coverageId} value={choiceIndex} disabled={busy || !betting || choices.length === 1} onChange={event => setChoiceIndex(Number(event.target.value))}>{choices.map((numbers,index) => <option key={numbers.join('-')} value={index}>{rouletteCoverageLabel(kind,numbers)}</option>)}</select></label></div></>
      : <section className="casino-your-bets" aria-label="Your bets this round"><div className="casino-section-heading"><h3>Your bets</h3><span>{credits(acceptedTotal)} / {credits(ROULETTE_MAX_ROUND_STAKE)} staked</span></div>{acceptedBets.length ? <PagedItems items={acceptedBets} label="Bet" render={({wagerId,bet},index) => <div className="casino-bet-row" key={wagerId}><span>{index + 1}. {rouletteKinds.find(option => option.kind === bet.kind)?.label}<small>{rouletteCoverageLabel(bet.kind,bet.numbers)}</small></span><strong>{bet.stake} credits</strong></div>} /> : <p className="casino-instruction">Each accepted bet appears here. You can place up to 20 per round.</p>}</section>}
    </div>
    <ActionDock host={actionHost} summary={<><span className="casino-dock-selection">{rouletteCoverageLabel(kind,selectedNumbers)}<small>{credits(grossReturn)} returned if won · includes stake</small></span><RoundReady table={table} profileId={profileId} eligible={acceptedBets.length > 0} busy={busy} now={now} send={send} /></>}>
      <RouletteStake value={stakeValue} onChange={setStakeValue} max={Math.min(Math.floor(balance/CASINO_STAKE_STEP)*CASINO_STAKE_STEP,ROULETTE_MAX_ROUND_STAKE-acceptedTotal)} disabled={busy || !betting} />
      <button type="button" className="casino-primary" disabled={busy || !betting || !validStake || balance < stake || limited} onClick={() => send({action:'roulette-bet',tableId:table.id,roundId:table.roundId,bet:{kind,numbers:selectedNumbers,stake}})}>{busy ? 'Placing bet…' : !betting ? 'Betting is closed' : !validStake ? 'Use 10-credit steps' : limited ? 'Round limit reached' : balance < stake ? 'Not enough credits' : `Place ${stake}-credit bet`}</button>
    </ActionDock>
  </div>;
}

function PlayingCard({ card }: { card: Card | null }) {
  if (!card) return <span className="casino-card is-hidden" aria-label="Face-down card"><span aria-hidden="true">M</span></span>;
  return <span className={`casino-card${card.suit === 'hearts' || card.suit === 'diamonds' ? ' is-red-card' : ''}`} aria-label={`${card.rank} of ${card.suit}`}><span aria-hidden="true">{card.rank}<small>{suitGlyph[card.suit]}</small></span><i aria-hidden="true">{suitGlyph[card.suit]}</i></span>;
}

function BlackjackCards({ cards }: { cards: (Card | null)[] }) {
  const [choice,setChoice] = useState(0);
  const page = Math.min(choice,Math.max(0,Math.ceil(cards.length/3)-1));
  if (cards.length>3) return <div className="blackjack-card-pages" role="group" aria-label="Cards in this hand"><button type="button" aria-label="Previous cards" disabled={page===0} onClick={()=>setChoice(page-1)}>←</button><div><div className="blackjack-card-tokens">{cards.slice(page*3,page*3+3).map((card,index)=><span key={index} className={card?.suit==='hearts'||card?.suit==='diamonds'?'is-red-card':''} aria-label={card?`${card.rank} of ${card.suit}`:'Face-down card'}>{card?.rank??'?'}<small>{card?suitGlyph[card.suit]:'M'}</small></span>)}</div><small>{page*3+1}–{Math.min(cards.length,page*3+3)} of {cards.length}</small></div><button type="button" aria-label="Next cards" disabled={(page+1)*3>=cards.length} onClick={()=>setChoice(page+1)}>→</button></div>;
  return <div className="casino-cards blackjack-card-fan" style={{ '--card-count': Math.max(2,cards.length) } as React.CSSProperties}>{cards.length ? cards.map((card,index)=><PlayingCard key={index} card={card}/>) : <><PlayingCard card={null}/><PlayingCard card={null}/></>}</div>;
}
function BlackjackHand({ hand, active, index, multiple, label }: { hand: BlackjackHandView; active: boolean; index: number; multiple: boolean; label?: string }) {
  return <div className={`blackjack-hand${active ? ' is-active' : ''}`}><div className="blackjack-hand-heading"><span>{label ?? (multiple ? `Hand ${index+1}` : 'Your hand')}{active ? ' · playing' : ''}</span><strong>{hand.soft ? 'Soft ' : ''}{hand.total}</strong></div><BlackjackCards cards={hand.cards}/><p className="blackjack-hand-outcome">{hand.outcome ?? (hand.state === 'playing' ? `${hand.stake} staked` : hand.state)}{hand.returned !== undefined && <strong>{credits(hand.returned)} returned</strong>}</p></div>;
}
function Blackjack({ table, now, profileId, balance, busy, send, actionHost }: { table: BlackjackView; now: number; profileId: string; balance: number; busy: boolean; send: Send; actionHost: HTMLElement | null }) {
  const [stake,setStake] = useState(CASINO_MIN_STAKE);
  const [stage,setStage] = useState<'hand'|'hand2'|'table'>('hand');
  const ownSeat = table.seats.find(seat => seat.player.profileId === profileId);
  const activeSeat = table.seats.find(seat => seat.seat === table.activeSeat);
  const deadline = effectiveDeadline(table);
  const betting = table.phase === 'betting' && now < deadline;
  const yourTurn = table.phase === 'playing' && table.activeSeat === ownSeat?.seat && now < table.deadline;
  const activeHand = yourTurn && table.activeHand !== null ? ownSeat?.hands[table.activeHand] : undefined;
  const handIndex = stage==='hand2' && (ownSeat?.hands.length ?? 0)>1 ? 1 : 0;
  const shownHand = ownSeat?.hands[handIndex];
  useEffect(() => { if (yourTurn) { setStage(table.activeHand===1?'hand2':'hand'); } }, [yourTurn,table.activeHand]);
  const label = table.phase === 'betting' ? 'Bets open' : table.phase === 'playing' ? yourTurn ? 'Your turn' : `${activeSeat?.player.name ?? 'Player'}’s turn` : table.phase === 'dealer' ? 'Dealer’s hand' : table.phase === 'result' ? 'Round complete' : 'Table paused';
  return <div className="blackjack-game casino-game"><RoundStatus label={label} deadline={effectiveDeadline(table)} now={now} waiting={table.phase === 'paused'} />
    <StageTabs<typeof stage> value={stage} onChange={setStage} label="Blackjack views" options={[{value:'hand',label:ownSeat ? ownSeat.hands.length>1?'Hand 1':'Your hand' : 'Dealer'},...(ownSeat && ownSeat.hands.length>1 ? [{value:'hand2' as const,label:'Hand 2'}]:[]),{value:'table',label:`At the table (${table.seats.length}/5)`}]} />
    <div className="casino-stage">{stage !== 'table' ? <><p className="casino-instruction">{yourTurn ? `Hand ${(table.activeHand ?? 0)+1}: hit for a card, or stand to keep your total.` : ownSeat?.hands.length ? 'Beat the dealer without going over 21.' : ownSeat ? 'Choose your stake and bet. Then Ready when you are set.' : 'Take an open seat below to join the next hand.'}</p><div className="blackjack-hand-stage"><section className="blackjack-dealer" aria-label="Dealer hand"><div className="casino-section-heading"><h3>Dealer</h3><span>{table.dealerTotal !== null ? `Total ${table.dealerTotal}` : 'Card concealed'}</span></div><BlackjackCards cards={table.dealer}/></section>{shownHand ? <section className="blackjack-player-controls" aria-label="Your blackjack controls"><BlackjackHand hand={shownHand} index={handIndex} multiple={(ownSeat?.hands.length ?? 0)>1} active={yourTurn && table.activeHand === handIndex}/></section> : <p className="casino-muted">{ownSeat ? betting ? 'Your cards appear after betting closes.' : 'You will join the next round.' : 'Blackjack pays 3:2. Dealer stands on all 17s.'}</p>}</div></>
    : <PagedItems items={Array.from({length:5},(_,seatNumber)=>{const seat=table.seats.find(entry=>entry.seat===seatNumber); return seat?.hands.length ? seat.hands.map((hand,handIndex)=>({seatNumber,seat,hand,handIndex})) : [{seatNumber,seat,hand:null,handIndex:0}];}).flat()} label="Table hand" render={({seatNumber,seat,hand,handIndex})=><section className="blackjack-table-place" key={`${seatNumber}-${handIndex}`}>{hand ? <BlackjackHand hand={hand} index={handIndex} label={`Seat ${seatNumber+1} · ${seat!.player.name}${seat!.hands.length>1?` · hand ${handIndex+1}`:''}`} multiple={seat!.hands.length>1} active={table.activeSeat===seatNumber&&table.activeHand===handIndex}/> : <><div className="casino-section-heading"><h3>Seat {seatNumber+1}</h3><span>{seat?.player.name ?? 'Open seat'}</span></div><p className="casino-instruction">{seat?'Seated · waiting for a bet.':'Use the matching seat button below to join.'}</p></>}</section>} />}</div>
    <ActionDock host={actionHost} summary={<><span>{yourTurn && activeHand ? `Playing hand ${(table.activeHand ?? 0)+1} · total ${activeHand.total}` : label}<small>{yourTurn ? 'An expired turn stands automatically.' : ownSeat?.hands.length ? `${ownSeat.hands.reduce((sum,hand)=>sum+hand.stake,0)} credits in play` : 'Take a seat, then place a bet.'}</small></span><RoundReady table={table} profileId={profileId} eligible={!!ownSeat?.hands.length} busy={busy} now={now} send={send}/></>}>
    {!ownSeat ? <div className="blackjack-seats" role="group" aria-label="Blackjack seats">{Array.from({length:5},(_,seatNumber)=>{const seat=table.seats.find(entry=>entry.seat===seatNumber); return <button key={seatNumber} type="button" className="blackjack-seat is-empty" disabled={busy || !!seat || table.phase==='paused'} onClick={()=>send({action:'blackjack-join',tableId:table.id,seat:seatNumber})} aria-label={`Take seat ${seatNumber+1}`}><strong>{seat ? 'Taken' : 'Join'}</strong><span>{seatNumber+1}</span></button>;})}</div>
    : ownSeat.hands.length===0 && betting ? <><StakeControl value={stake} onChange={setStake} disabled={busy}/><button type="button" className="casino-primary" disabled={busy || balance<stake} onClick={()=>send({action:'blackjack-bet',tableId:table.id,roundId:table.roundId,stake})}>{balance<stake?'Not enough credits':`Bet ${stake} credits`}</button></>
    : activeHand ? <div className="blackjack-actions" role="group" aria-label="Your available actions">{(['hit','stand','double','split'] as const).map(move=><button key={move} type="button" className={move==='hit'?'casino-primary':'casino-secondary'} disabled={busy || !activeHand.actions.includes(move) || ((move==='double'||move==='split') && balance<activeHand.stake)} onClick={()=>send({action:'blackjack-action',tableId:table.id,roundId:table.roundId,hand:table.activeHand!,move})}>{move[0].toUpperCase()+move.slice(1)}{(move==='double'||move==='split') && <small>+{activeHand.stake}</small>}</button>)}</div>
    : <p className="casino-dock-waiting">{ownSeat.hands.length && betting ? 'Bet accepted. Ready to deal, or wait for the timer.' : table.phase==='result'?'Round complete. See Results for your return.':'Watch the table. Your controls appear on your turn.'}</p>}
    </ActionDock></div>;
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
  const available = table.phase === 'idle' || table.phase === 'result' && isOwner && !!table.player?.connected;
  const displayReels = spinning ? Array.from({ length: 3 }, (_, index) => SLOT_SYMBOLS[(Math.floor(Math.max(0, SLOTS_SPIN_MS - remaining) / 95) + index) % SLOT_SYMBOLS.length]) : table.reels;
  return <>
    <RoundStatus label={spinning ? isOwner ? 'Your reels are spinning' : `${table.player?.name ?? 'Someone'} is playing` : table.phase === 'paused' ? 'Machine paused' : table.phase === 'result' ? available ? 'Your result · spin again when ready' : 'Machine reserved briefly' : 'Ready when you are'} deadline={effectiveDeadline(table)} now={now} waiting={table.phase === 'idle' || table.phase === 'paused'} />
    <div className={`slots-machine${spinning && remaining > 0 ? ' is-spinning' : ''}`}>
      <span className="slots-machine-brand">MERIDIAN</span><h3>A turn of fortune.</h3><div className="slots-reels" role="group" aria-label={spinning ? 'Reels spinning' : 'Reel result'} aria-live="off">{Array.from({ length: 3 }, (_, index) => <div className="slot-reel" key={index} aria-hidden={spinning}>{spinning && (reducedMotion || remaining === 0) ? <span className="slot-waiting-mark">M</span> : <SlotMark symbol={displayReels[index] ?? SLOT_SYMBOLS[index]} />}</div>)}</div>
      <div className="slots-result" role="status">{spinning ? <><strong>{remaining > 0 ? 'Spinning…' : 'Waiting for the result…'}</strong><span>{table.stake} credits staked</span></> : table.phase === 'result' && table.returned !== null ? <><strong>{table.returned > table.stake ? `${credits(table.returned)} credits returned` : table.returned === table.stake ? 'Stake returned' : 'No winning line'}</strong><span>{isOwner ? 'Your spin' : `${table.player?.name ?? 'Previous player'}’s spin`} · {table.stake} credits staked</span></> : <><strong>Three reels. One line.</strong><span>Choose your stake, then take a spin.</span></>}</div>
    </div>
    <ActionDock host={actionHost} summary={<><span>{spinning ? 'Reels are spinning' : table.phase === 'result' && table.returned !== null ? `${credits(table.returned)} credits returned` : 'One spin at a time'}</span><span>{spinning ? `${Math.ceil(remaining / 1000)}s` : table.phase === 'result' ? available ? 'Ready for another spin' : 'Machine reserved briefly' : `${CASINO_MIN_STAKE}–${CASINO_MAX_STAKE} credits`}</span></>}>
      <StakeControl value={stake} onChange={setStake} disabled={busy || !available} />
      <button type="button" className="casino-primary" disabled={busy || !available || balance < stake} onClick={() => send({ action: 'slots-spin', tableId: table.id, stake })}>{busy ? 'Starting spin…' : spinning ? 'Spin in progress' : table.phase === 'paused' ? 'Machine paused' : table.phase === 'result' && !available ? 'Machine reserved briefly' : balance < stake ? 'Not enough credits' : `Spin for ${stake} credits`}</button>
    </ActionDock>
    <p className="casino-fine">One spin per press. The machine is shared; wait for its current spin to finish.</p>
  </>;
}


function TableResults({ table }: { table: CasinoTableView }) {
  const entries: { title:string; detail:string }[] = table.game==='roulette' ? table.history.map((number,index)=>({title:`${index===0?'Latest spin':`Earlier spin ${index}`} · ${number}`,detail:number===0?'Zero':isRed(number)?'Red':'Black'}))
    : table.game==='craps' ? table.history.map((roll,index)=>({title:`Roll ${index+1} · ${roll.total}`,detail:`${roll.dice[0]} + ${roll.dice[1]}${roll.pointAfter!==null ? ` · point ${roll.pointAfter} stays in play` : ` · ${roll.resolution==='pass-wins'?'Pass wins':roll.resolution==='bar-twelve'?'Don’t Pass pushes':'Don’t Pass wins'}`}`}))
    : table.game==='poker' && table.phase==='result' ? [...table.winners.map(winner=>({title:`${table.seats.find(seat=>seat.seat===winner.seat)?.player.name ?? `Seat ${winner.seat+1}`} · ${credits(winner.amount)} chips`,detail:winner.hand ?? 'Hand winner'})),...table.pots.flatMap((pot,index)=>pot.winnerSeats.map((number,winnerIndex)=>({title:`${index===0?'Main pot':`Side pot ${index}`} · ${credits(pot.amount)} chips`,detail:`${pot.winnerSeats.length>1?`Shared winner ${winnerIndex+1}/${pot.winnerSeats.length}`:'Won by'} · ${table.seats.find(seat=>seat.seat===number)?.player.name ?? `Seat ${number+1}`}`})))]
    : table.game==='blackjack' && table.phase==='result' ? table.seats.flatMap(seat=>seat.hands.map((hand,index)=>({title:`${seat.player.name} · hand ${index+1}`,detail:`${hand.outcome ?? hand.state} · total ${hand.total} · ${hand.stake} staked / ${hand.returned ?? 0} returned`})))
    : table.game==='slots' && table.phase==='result' ? [{title:table.reels.join(' · '),detail:`${table.player?.name ?? 'Player'} · ${table.returned ?? 0} credits returned`}]:[];
  return entries.length ? <PagedItems items={entries} label="Table result" render={(entry,index)=><article className="casino-table-result" key={index}><h3>{entry.title}</h3><p>{entry.detail}</p></article>}/> : <p className="casino-instruction">Table details appear after the current round is revealed.</p>;
}

export function CasinoPanel({ open, table, serverTime, profileId, balance, privateState, busy, error, notice, latestResult, onCommand, onClose, chat }: CasinoPanelProps) {
  const panel = useRef<HTMLDivElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const closeAction = useRef(onClose);
  const titleId = useId();
  const now = useServerNow(open, serverTime);
  const [actionContainer, setActionContainer] = useState<HTMLDivElement | null>(null);
  const actionHost = actionContainer;
  const [view,setView] = useState<CasinoView>('play');
  const feedbackNotice = notice==='Accepted' || notice==='Wager accepted' || notice==='Spin accepted' || notice==='Synchronized' ? '' : notice;
  const actionMessage = error || feedbackNotice;
  const [messageOpen,setMessageOpen] = useState(!!actionMessage);
  useEffect(() => { setMessageOpen(!!actionMessage); }, [actionMessage]);
  const [lastResults,setLastResults] = useState<Record<string,CasinoResult>>({});
  const [lastTableResults,setLastTableResults] = useState<Record<string,CasinoTableView>>({});
  const resultTable = table?.phase==='result' ? table : table ? lastTableResults[table.id] ?? table : null;
  useEffect(() => { if (table?.phase==='result') setLastTableResults(previous=>({...previous,[table.id]:table})); }, [table]);
  const currentResult = table ? summariseCasinoResult(table,privateState,profileId) : null;
  useEffect(() => { if (currentResult) setLastResults(previous => previous[currentResult.tableId]?.id === currentResult.id ? previous : {...previous,[currentResult.tableId]:currentResult}); }, [currentResult?.id]);
  useEffect(() => { setView('play'); }, [table?.id]);
  const turnSeat = table && (table.game==='blackjack'||table.game==='poker') ? table.seats.find(seat=>seat.player.profileId===profileId) : null;
  const ownTurnKey = table?.game==='blackjack' && table.phase==='playing' && turnSeat?.seat===table.activeSeat ? `${table.id}:${table.roundId}:${table.activeHand}` : table?.game==='poker' && turnSeat?.seat===table.activeSeat && ['preflop','flop','turn','river'].includes(table.phase) ? privateState.poker?.actions?.turnId : null;
  useEffect(() => { if (ownTurnKey) { setView('play'); setMessageOpen(false); } }, [ownTurnKey]);
  const lastResult = currentResult ?? latestResult ?? (table ? lastResults[table.id] : null);
  useEffect(() => { closeAction.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    closeButton.current?.focus({ preventScroll: true });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (event.target instanceof Element && event.target.closest('.chat-panel')) return;
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
  const ownSeat = table && (table.game === 'poker' || table.game === 'blackjack') ? table.seats.find(seat => seat.player.profileId === profileId) : undefined;
  const pokerPlayer = table?.game === 'poker' && privateState.poker?.tableId === table.id ? privateState.poker : null;
  const hasSeat = !!ownSeat || !!pokerPlayer || table?.game === 'slots' && table.player?.profileId === profileId && table.player.connected;
  const leaving = ownSeat && ('leaving' in ownSeat ? ownSeat.leaving : !ownSeat.player.connected);
  function leaveTable() {
    if (!table || busy || leaving) return;
    if (pokerPlayer) send({ action: 'poker-leave', tableId: 'poker-1', escrowId: pokerPlayer.escrowId });
    else if (hasSeat) send({ action: 'leave', tableId: table.id });
    else onClose();
  }
  const name = table ? (CASINO_ANCHORS.find(anchor => anchor.id === table.id)?.name ?? 'Meridian Casino').replace('European roulette · Table','Roulette ·').replace('Blackjack · Table','Blackjack ·') : 'Meridian Casino';
  return <div ref={panel} className="casino-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}><section className="casino-panel" onClickCapture={event=>{ if (actionContainer?.contains(event.target as Node)) { setView('play'); setMessageOpen(false); } }}>
    <header className="casino-header"><div><span className="eyebrow">THE MERIDIAN CASINO</span><h2 id={titleId}>{name}</h2></div><button type="button" className="casino-leave" disabled={busy || !!leaving || !table} onClick={leaveTable}>{leaving ? 'Leaving…' : hasSeat ? 'Leave seat' : 'Leave table'}</button><button ref={closeButton} type="button" className="casino-close" aria-label="Close casino table" onClick={onClose}><CloseIcon /></button><div className="casino-wallet"><span>Your credits</span><strong aria-label="Casino credit balance">{credits(balance)}</strong><span className="casino-fictional">FICTIONAL CURRENCY</span></div></header>
    <nav className="casino-view-tabs" aria-label="Casino views">{([{value:'play',label:'Play'},{value:'rules',label:'How to play'},{value:'results',label:'Results'}] as const).map(tab=><button type="button" key={tab.value} aria-pressed={!messageOpen&&view===tab.value} onClick={()=>{setView(tab.value);setMessageOpen(false);}}>{tab.label}</button>)}{actionMessage&&<button type="button" className={`casino-message-tab${error?' is-error':''}`} aria-pressed={messageOpen} onClick={()=>setMessageOpen(true)}>Message</button>}</nav>
    <div className="casino-body" key={table?.id ?? 'loading'}><div className="casino-play-view" hidden={view!=='play'||messageOpen}>{!table ? <p className="casino-muted" role="status">Connecting to the table…</p> : table.game === 'roulette' ? <Roulette table={table} now={now} profileId={profileId} balance={balance} privateState={privateState} busy={busy} send={send} actionHost={actionHost} /> : table.game === 'blackjack' ? <Blackjack table={table} now={now} profileId={profileId} balance={balance} busy={busy} send={send} actionHost={actionHost} /> : table.game === 'craps' ? <CrapsGame table={table} now={now} profileId={profileId} balance={balance} privateState={privateState} busy={busy} send={send} actionHost={actionHost} /> : table.game === 'poker' ? <PokerGame table={table} now={now} profileId={profileId} balance={balance} privateState={privateState} busy={busy} send={send} actionHost={actionHost} /> : <Slots table={table} now={now} profileId={profileId} balance={balance} busy={busy} send={send} actionHost={actionHost} />}</div>
    {table && !messageOpen && view==='rules' && <CasinoRules game={table.game}/>}
    {table && !messageOpen && view==='results' && <section className="casino-result-pages" aria-label="Casino results"><div className="casino-personal-result">{lastResult ? <><span className="casino-label">YOUR LAST RESULT</span><strong className={lastResult.net>0?'is-win':lastResult.net<0?'is-loss':''}>{lastResult.net>0?'+':''}{credits(lastResult.net)} {lastResult.unit}</strong><p>{credits(lastResult.stake)} staked · {credits(lastResult.returned)} returned</p></> : <><h3>Your results</h3><p>Play a round to see your result here.</p></>}</div><TableResults table={resultTable ?? table}/></section>}
    {messageOpen && actionMessage && <section className="casino-message-stage" aria-label="Action message"><span className="casino-label">{error?'ACTION NOT COMPLETED':'TABLE UPDATE'}</span><p role={error?'alert':'status'}>{actionMessage}</p><button type="button" className="casino-secondary" onClick={()=>{setMessageOpen(false);setView('play');}}>Back to play</button></section>}
    </div>
    <div ref={setActionContainer} className="casino-mobile-actions" />
  </section>{chat}<p className="casino-world-note" aria-hidden="true">THE MERIDIAN<span>Stay a while.</span></p></div>;
}
