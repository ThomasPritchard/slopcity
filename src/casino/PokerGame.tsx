import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Card, CasinoCommand, CasinoPrivateState } from '../../shared/casino';
import {
  POKER_BIG_BLIND, POKER_BUY_IN_STEP, POKER_DEFAULT_BUY_IN, POKER_MAX_BUY_IN,
  POKER_MIN_BUY_IN, POKER_SMALL_BLIND, POKER_TURN_MS,
  type PokerMove, type PokerSeatView, type PokerView,
} from '../../shared/poker';
import './poker.css';

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export interface PokerGameProps {
  table: PokerView;
  now: number;
  profileId: string;
  balance: number;
  privateState: CasinoPrivateState;
  busy: boolean;
  send(command: DistributiveOmit<CasinoCommand, 'requestId'>): void;
  actionHost: HTMLElement | null;
}

const chips = (value: number) => value.toLocaleString('en-GB');
const suitGlyph: Record<Card['suit'], string> = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };
const rankName: Partial<Record<Card['rank'], string>> = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack' };
const phaseNames: Record<PokerView['phase'], string> = { waiting: 'Between hands', preflop: 'Before the flop', flop: 'Flop', turn: 'Turn', river: 'River', runout: 'Dealing the board', result: 'Hand complete', paused: 'Table paused' };
const bettingPhases: readonly PokerView['phase'][] = ['preflop', 'flop', 'turn', 'river'];

function PokerCard({ card, empty = false }: { card: Card | null; empty?: boolean }) {
  const label = card ? `${rankName[card.rank] ?? card.rank} of ${card.suit}` : empty ? 'Not dealt' : 'Face-down card';
  return <span className={`casino-card poker-card${card && (card.suit === 'hearts' || card.suit === 'diamonds') ? ' is-red-card' : ''}${!card ? empty ? ' is-empty' : ' is-hidden' : ''}`} role="img" aria-label={label}>
    {card ? <><span aria-hidden="true">{card.rank}<small>{suitGlyph[card.suit]}</small></span><i aria-hidden="true">{suitGlyph[card.suit]}</i></> : <span aria-hidden="true">{empty ? '—' : 'M'}</span>}
  </span>;
}

function seatStatus(seat: PokerSeatView, active: boolean) {
  if (seat.leaving) return seat.state === 'all-in' ? 'All-in · leaving after hand' : 'Leaving after hand';
  if (!seat.player.connected) return 'Away';
  if (seat.state === 'all-in') return 'All-in';
  if (seat.state === 'folded') return 'Folded';
  if (active) return 'To act';
  return seat.state === 'waiting' ? 'Waiting for a hand' : 'In the hand';
}

function BuyInControl({ value, disabled, onChange }: { value: number; disabled: boolean; onChange(value: number): void }) {
  const labelId = useId();
  return <div className="casino-stake poker-buy-in">
    <span id={labelId} className="casino-label">Buy-in from wallet</span>
    <div role="group" aria-labelledby={labelId}>
      <button type="button" aria-label="Decrease buy-in" disabled={disabled || value <= POKER_MIN_BUY_IN} onClick={() => onChange(Math.max(POKER_MIN_BUY_IN, value - POKER_BUY_IN_STEP))}>−</button>
      <output aria-live="polite">{value}<span>credits</span></output>
      <button type="button" aria-label="Increase buy-in" disabled={disabled || value >= POKER_MAX_BUY_IN} onClick={() => onChange(Math.min(POKER_MAX_BUY_IN, value + POKER_BUY_IN_STEP))}>+</button>
    </div>
    <span className="casino-stake-range">{POKER_MIN_BUY_IN}–{chips(POKER_MAX_BUY_IN)} · steps of {POKER_BUY_IN_STEP}</span>
  </div>;
}

export function PokerGame({ table, now, profileId, balance, privateState, busy, send, actionHost }: PokerGameProps) {
  const [buyIn, setBuyIn] = useState(POKER_DEFAULT_BUY_IN);
  const [seatChoice, setSeatChoice] = useState(0);
  const [raiseChoice, setRaiseChoice] = useState<{ turnId: string; value: string } | null>(null);
  const reasonId = useId(), raiseId = useId(), raiseHelpId = useId(), seatsId = useId();
  const ownSeat = table.seats.find(seat => seat.player.profileId === profileId);
  const player = privateState.poker?.tableId === table.id ? privateState.poker : null;
  const hasPlace = !!ownSeat || !!player;
  const betweenHands = table.phase === 'waiting' || table.phase === 'result';
  const availableSeats = Array.from({ length: 6 }, (_, seat) => seat).filter(seat => !table.seats.some(occupied => occupied.seat === seat));
  const selectedSeat = availableSeats.includes(seatChoice) ? seatChoice : availableSeats[0];
  const canJoin = !hasPlace && betweenHands && selectedSeat !== undefined && balance >= buyIn && !busy;
  const canRejoin = !!player?.canRejoin && table.phase !== 'paused' && !busy;
  const matchingHand = !!player && !!ownSeat && player.seat === ownSeat.seat && table.handId !== null && player.handId === table.handId;
  const yourTurn = matchingHand && !player.canRejoin && !ownSeat.leaving && ownSeat.state === 'playing' && table.activeSeat === ownSeat.seat && bettingPhases.includes(table.phase);
  const actions = yourTurn && player.actions?.turnId ? player.actions : null;
  const canAct = !!actions && !busy && table.deadline > now;
  const holeCards = matchingHand && !player.canRejoin ? player.holeCards : [];
  const raiseValue = actions ? raiseChoice?.turnId === actions.turnId ? raiseChoice.value : String(actions.minRaiseTo) : '';
  const raiseTo = Number(raiseValue);
  const validRaise = !!actions?.canRaise && raiseValue.trim() !== '' && Number.isSafeInteger(raiseTo) && raiseTo >= actions.minRaiseTo && raiseTo <= actions.maxRaiseTo;
  const remaining = Math.max(0, Math.ceil((table.deadline - now) / 1000));
  const activePlayer = table.seats.find(seat => seat.seat === table.activeSeat);
  const nameForSeat = (seat: number) => table.seats.find(playerSeat => playerSeat.seat === seat)?.player.name ?? `Seat ${seat + 1}`;
  const readyPlayers = table.seats.filter(seat => seat.player.connected && !seat.leaving && seat.stack > 0).length;
  const phaseLabel = table.phase === 'waiting' ? readyPlayers < 2 ? 'Waiting for two players' : 'Next hand shortly'
    : yourTurn ? `Your turn · ${phaseNames[table.phase]}` : activePlayer && bettingPhases.includes(table.phase) ? `${activePlayer.player.name} to act · ${phaseNames[table.phase]}` : phaseNames[table.phase];
  const resultSummary = table.phase === 'result' ? table.winners.map(winner => `${nameForSeat(winner.seat)} wins ${chips(winner.amount)} chips${winner.hand ? ` with ${winner.hand}` : ''}.`).join(' ') : '';
  const actionReason = table.phase === 'paused' ? 'Play resumes when the table is ready.'
    : player?.canRejoin ? 'Your seat and table chips are waiting. Rejoin to continue playing.'
      : ownSeat?.leaving ? 'Leaving folds on your next turn. All-in hands and hands with betting complete stay live; remaining chips return after the hand.'
        : !hasPlace ? !betweenHands ? 'A hand is in progress. Choose a seat and buy in between hands.' : selectedSeat === undefined ? 'All six seats are taken. You can watch while you wait.' : balance < buyIn ? 'Lower the buy-in or wait until you have enough wallet credits.' : 'Choose an open seat. Your buy-in moves wallet credits into table chips.'
          : yourTurn ? 'Choose an available action before the timer ends.'
            : ownSeat?.state === 'all-in' ? 'You are all-in. Your hand stays live while the remaining cards are dealt.'
              : ownSeat?.state === 'folded' ? 'You folded. You can play again in the next hand.'
                : table.phase === 'result' ? 'Winnings stay in your table stack for the next hand.'
                  : table.phase === 'waiting' ? 'The next hand needs at least two players with table chips.' : ownSeat?.state === 'waiting' ? 'You will be dealt in at the next hand.' : 'Watch the table. Your controls open when it is your turn.';
  const waitingLabel = busy ? 'Waiting for the table…' : table.phase === 'paused' ? 'Table paused' : ownSeat?.leaving ? 'Leaving after this hand' : ownSeat?.state === 'all-in' ? 'All-in · waiting for result' : ownSeat?.state === 'folded' ? 'Folded · next hand shortly' : table.phase === 'result' ? 'Next hand shortly' : table.phase === 'waiting' ? readyPlayers < 2 ? 'Waiting for two players' : 'Next hand shortly' : 'Waiting for your turn';

  function play(move: PokerMove) {
    if (!canAct || !actions || !table.handId) return;
    const allowed = move === 'fold' ? actions.canFold : move === 'check' ? actions.canCheck : move === 'call' ? actions.canCall : move === 'all-in' ? actions.canAllIn : actions.canRaise && validRaise;
    if (allowed) send({ action: 'poker-action', tableId: table.id, handId: table.handId, turnId: actions.turnId, move, ...(move === 'raise' ? { raiseTo } : {}) });
  }

  const controls = player?.canRejoin ? <button type="button" className="casino-primary poker-wide-action" disabled={!canRejoin} aria-describedby={reasonId} onClick={() => { if (canRejoin) send({ action: 'poker-rejoin', tableId: table.id, escrowId: player.escrowId }); }}>{busy ? 'Rejoining…' : 'Rejoin your seat'}</button>
    : !hasPlace ? <>
      <BuyInControl value={buyIn} onChange={setBuyIn} disabled={busy || !betweenHands || table.phase === 'paused'} />
      <button type="button" className="casino-primary" disabled={!canJoin} aria-describedby={reasonId} onClick={() => { if (canJoin) send({ action: 'poker-join', tableId: table.id, seat: selectedSeat, buyIn }); }}>{busy ? 'Joining…' : !betweenHands ? 'Join between hands' : selectedSeat === undefined ? 'Table full' : balance < buyIn ? 'Not enough credits' : `Join seat ${selectedSeat + 1}`}</button>
    </> : actions ? <div className="poker-turn-controls">
      <div className="poker-basic-actions" role="group" aria-label="Your poker actions">
        {actions.canFold && <button type="button" className="casino-secondary" disabled={!canAct} onClick={() => play('fold')}>Fold</button>}
        {actions.canCheck && <button type="button" className="casino-primary" disabled={!canAct} onClick={() => play('check')}>Check</button>}
        {actions.canCall && <button type="button" className="casino-primary" disabled={!canAct} aria-label={`Call ${chips(actions.callAmount)} chips`} onClick={() => play('call')}>Call {chips(actions.callAmount)}</button>}
        {actions.canAllIn && <button type="button" className="casino-secondary" disabled={!canAct} aria-label={`All-in, add ${chips(ownSeat?.stack ?? 0)} chips`} onClick={() => play('all-in')}>All-in {chips(ownSeat?.stack ?? 0)}</button>}
      </div>
      {actions.canRaise && <div className="poker-raise-controls">
        <label className="poker-raise-field" htmlFor={raiseId}><span>Raise total</span><input id={raiseId} type="number" inputMode="numeric" min={actions.minRaiseTo} max={actions.maxRaiseTo} step={1} value={raiseValue} disabled={!canAct} aria-describedby={raiseHelpId} aria-invalid={!validRaise} onChange={event => setRaiseChoice({ turnId: actions.turnId, value: event.target.value })} /></label>
        <button type="button" className="casino-secondary" disabled={!canAct || !validRaise} aria-describedby={raiseHelpId} onClick={() => play('raise')}>{validRaise ? `Raise to ${chips(raiseTo)}` : 'Enter a valid total'}</button>
      </div>}
    </div> : <button type="button" className="casino-secondary poker-wide-action" disabled aria-describedby={reasonId}>{waitingLabel}</button>;

  const dockSummary = <><span className="poker-dock-player">{actionHost && holeCards.length > 0 && <span className="poker-dock-cards" role="group" aria-label="Your two hole cards">{holeCards.map((card, index) => <PokerCard key={index} card={card} />)}</span>}<span className="casino-dock-selection">{player?.canRejoin ? 'Your seat is saved' : ownSeat ? yourTurn ? 'Your turn' : `Seat ${ownSeat.seat + 1}` : selectedSeat === undefined ? 'Watching the table' : `Seat ${selectedSeat + 1}`}<small>{ownSeat ? `${chips(ownSeat.stack)} table chips` : `${chips(buyIn)} credits to buy in`}</small></span></span><span className="casino-dock-return">{actions?.canCall ? `${chips(actions.callAmount)} chips to call` : `Pot ${chips(table.pot)}`}<small>{hasPlace ? `Blinds ${POKER_SMALL_BLIND} / ${POKER_BIG_BLIND}` : '1 credit = 1 table chip'}</small></span></>;

  return <div className={`poker-game${actionHost ? ' has-action-dock' : ''}`} data-phase={table.phase}>
    <p className="sr-only" role="status" aria-atomic="true">{phaseLabel}. {resultSummary} {player?.canRejoin ? 'Rejoin your saved seat to play.' : ownSeat?.leaving ? 'Leaving after this hand.' : actions ? actions.canCheck ? 'You can check.' : actions.canCall ? `${chips(actions.callAmount)} chips to call.` : 'Choose an available action.' : ''}</p>
    <div className="casino-round-status"><span><i aria-hidden="true" />{phaseLabel}</span>{table.deadline > 0 && table.phase !== 'paused' && <span className="casino-countdown" aria-label={remaining ? `${remaining} seconds remaining` : 'Waiting for the table'}>{remaining ? `${remaining}s` : 'Waiting…'}</span>}</div>

    <section className="poker-board" aria-label="Community cards and pot">
      <div className="casino-section-heading"><h3>Community cards</h3><span className="poker-pot">Pot <strong>{chips(table.pot)}</strong> chips</span></div>
      <div className="casino-cards poker-board-cards">{Array.from({ length: 5 }, (_, index) => <PokerCard key={index} card={table.board[index] ?? null} empty={!table.board[index]} />)}</div>
      <p className="poker-table-limits">Texas Hold’em · 6 seats · blinds {POKER_SMALL_BLIND} / {POKER_BIG_BLIND}</p>
    </section>

    {hasPlace && <section className="poker-your-place" aria-label="Your poker hand and table chips">
      <div className="casino-section-heading"><h3>{actionHost ? 'Your seat' : 'Your hand'}</h3>{player && <button type="button" className="casino-text-button poker-leave" disabled={busy || !!ownSeat?.leaving || table.phase === 'paused'} onClick={() => { if (!busy && !ownSeat?.leaving && table.phase !== 'paused') send({ action: 'poker-leave', tableId: table.id, escrowId: player.escrowId }); }}>{ownSeat?.leaving ? 'Leaving…' : 'Leave table'}</button>}</div>
      <div className="poker-own-hand"><div className="casino-cards" aria-label="Your two hole cards">{Array.from({ length: 2 }, (_, index) => <PokerCard key={index} card={holeCards[index] ?? null} empty={!holeCards[index]} />)}</div><dl><div><dt>Your table chips</dt><dd>{ownSeat ? chips(ownSeat.stack) : 'Waiting…'}</dd></div><div><dt>In the pot this hand</dt><dd>{chips(ownSeat?.committed ?? 0)}</dd></div></dl></div>
      <p className="casino-fine">{betweenHands ? 'Leave to return your remaining table chips to your wallet.' : 'Leaving folds on your next turn. All-in hands and hands with betting complete stay live; remaining chips return after the hand.'}</p>
    </section>}

    {table.phase === 'result' && table.winners.length > 0 && <section className="poker-results" aria-label="Poker hand result">
      <div className="casino-section-heading"><h3>{table.winners.length === 1 ? 'Hand winner' : 'Hand winners'}</h3><span>Awards in table chips</span></div>
      <ul className="poker-winners">{table.winners.map(winner => <li key={winner.seat}><span><strong>{nameForSeat(winner.seat)}</strong>{winner.hand && <small>{winner.hand}</small>}</span><strong>{chips(winner.amount)} chips</strong></li>)}</ul>
      {table.pots.length > 0 && <ol className="poker-pots" aria-label="Pot awards">{table.pots.map((pot, index) => <li key={index}><span>{index === 0 ? 'Main pot' : `Side pot ${index}`} · {chips(pot.amount)} chips</span><small>{pot.winnerSeats.length > 1 ? 'Shared by ' : 'Won by '}{pot.winnerSeats.map(nameForSeat).join(', ')}</small></li>)}</ol>}
    </section>}

    <p id={reasonId} className="casino-fine poker-action-reason">{actionReason}</p>
    {actionHost ? createPortal(<div className="casino-action-dock poker-action-dock"><div className="casino-dock-summary">{dockSummary}</div><div className="casino-dock-controls poker-dock-controls">{controls}</div></div>, actionHost) : <div className="poker-inline-controls"><div className="poker-controls-summary">{dockSummary}</div><div className="poker-dock-controls">{controls}</div></div>}
    {actions?.canRaise && <p id={raiseHelpId} className="casino-fine poker-raise-help">Raise total means your total bet in this betting round, including {chips(ownSeat?.bet ?? 0)} already bet. Enter {chips(actions.minRaiseTo)}–{chips(actions.maxRaiseTo)}.{validRaise ? ` Raising to ${chips(raiseTo)} adds ${chips(raiseTo - (ownSeat?.bet ?? 0))} chips.` : ' Enter a whole number within this range.'}</p>}

    <section className="poker-seating" aria-labelledby={seatsId}><div className="casino-section-heading"><h3 id={seatsId}>At the table</h3><span>{table.seats.length} / 6 seated</span></div>
      <div className="poker-seats">{Array.from({ length: 6 }, (_, seatNumber) => {
        const seat = table.seats.find(entry => entry.seat === seatNumber);
        const active = table.activeSeat === seatNumber && bettingPhases.includes(table.phase);
        return seat ? <div key={seatNumber} className={`poker-seat${seat.player.profileId === profileId ? ' is-yours' : ''}${active ? ' is-active' : ''}`}>
          <div className="poker-seat-heading"><span>Seat {seatNumber + 1}</span><span className="poker-seat-markers">{table.button === seatNumber && <abbr title="Dealer button">D</abbr>}{table.smallBlindSeat === seatNumber && <abbr title="Small blind">SB</abbr>}{table.bigBlindSeat === seatNumber && <abbr title="Big blind">BB</abbr>}</span></div>
          <strong className="poker-player-name">{seat.player.profileId === profileId ? `${seat.player.name} · you` : seat.player.name}</strong><span className="poker-seat-stack">{chips(seat.stack)} chips</span><small className="poker-seat-state">{seatStatus(seat, active)}</small>
          <span className="poker-seat-bet">Bet {chips(seat.bet)} · in pot {chips(seat.committed)}</span>
          {seat.cards.length > 0 && <div className="poker-seat-cards" aria-label={`${seat.player.name}’s public cards`}>{seat.cards.map((card, index) => <PokerCard key={index} card={card} />)}</div>}
        </div> : <button key={seatNumber} type="button" className="poker-seat is-empty" aria-label={`Select seat ${seatNumber + 1}`} aria-pressed={!hasPlace && selectedSeat === seatNumber} disabled={busy || hasPlace || !betweenHands} onClick={() => setSeatChoice(seatNumber)}><span>Seat {seatNumber + 1}</span><strong>Open seat</strong><small>{!hasPlace && selectedSeat === seatNumber ? 'Selected' : 'Choose this seat'}</small></button>;
      })}</div>
      {table.message && <p className="casino-fine poker-table-message">{table.message}</p>}
    </section>

    <details className="casino-rules poker-rules"><summary>How to play & table chips <span aria-hidden="true">+</span></summary>
      <p>Texas Hold’em for two to six players. Make the best five-card poker hand using any combination of your two hole cards and the five community cards. Betting runs before the flop, then after the flop, turn and river.</p>
      <p>Blinds are {POKER_SMALL_BLIND} / {POKER_BIG_BLIND} chips. D marks the dealer button, SB the small blind and BB the big blind. The button moves around the table between hands.</p>
      <p>Buy in between hands for {POKER_MIN_BUY_IN}–{chips(POKER_MAX_BUY_IN)} wallet credits, in steps of {POKER_BUY_IN_STEP}. One credit becomes one table chip. Your wallet and table stack are separate; winnings stay at the table until you leave.</p>
      <p>On your turn, choose an available action within {POKER_TURN_MS / 1000} seconds. Check puts in no more chips; call matches the displayed cost. “Raise to” sets your total bet for the current betting round, including chips you already bet. All-in puts your remaining stack into the hand.</p>
      <p>If an all-in player has fewer chips than others, extra bets form side pots. Each pot can only be won by a player who contributed to it and stayed in the hand. Tied winning hands share that pot.</p>
      <p>Leaving folds on your next turn. All-in hands and hands with betting complete stay live; remaining chips return after the hand. Between hands, leave to return your table chips to your wallet immediately.</p>
      <p>All chips and credits are fictional. There is no real-money play, purchase or cash-out.</p>
    </details>
  </div>;
}
