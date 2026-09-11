import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CASINO_MAX_STAKE, CASINO_MIN_STAKE, CASINO_STAKE_STEP,
  type CasinoCommand, type CasinoPrivateState,
} from '../../shared/casino';
import {
  crapsReturn,
  type CrapsBetKind, type CrapsResult, type CrapsView,
} from '../../shared/craps';
import { effectiveDeadline, RoundReady } from './RoundReady';
import './craps.css';

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export interface CrapsGameProps {
  table: CrapsView;
  now: number;
  profileId: string;
  balance: number;
  privateState: CasinoPrivateState;
  busy: boolean;
  send(command: DistributiveOmit<CasinoCommand, 'requestId'>): void;
  actionHost: HTMLElement | null;
}

const credits = (value: number) => value.toLocaleString('en-GB');
const lineName = (kind: CrapsBetKind) => kind === 'pass' ? 'Pass' : 'Don’t Pass';
const pipPositions: Readonly<Record<number, readonly number[]>> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

/** Decorative pips accompany the complete, visible text result. Unlanded dice have no face. */
function Die({ value }: { value?: number }) {
  return <svg className={`craps-die${value === undefined ? ' is-unrevealed' : ''}`} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <rect className="craps-die-face" x="1" y="1" width="46" height="46" rx="8" />
    {value === undefined ? <path className="craps-die-waiting" d="M19 24h10" /> : pipPositions[value]?.map(position => <circle key={position} cx={13 + position % 3 * 11} cy={13 + Math.floor(position / 3) * 11} r="3" />)}
  </svg>;
}

function resultHeading(result: CrapsResult) {
  switch (result.resolution) {
    case 'point-set': return `Point is ${result.pointAfter}`;
    case 'point-continues': return `Point stays ${result.pointAfter}`;
    case 'pass-wins': return result.pointBefore === null ? 'Pass wins' : 'Point made';
    case 'dont-pass-wins': return result.pointBefore === null ? 'Don’t Pass wins' : 'Seven out';
    case 'bar-twelve': return 'Pass loses · Don’t Pass pushes';
  }
}

function resultExplanation(result: CrapsResult) {
  if (result.pointAfter !== null) return 'Both lines stay in play for the next roll.';
  if (result.resolution === 'bar-twelve') return 'Don’t Pass stakes are returned. New bets open shortly.';
  return `${result.resolution === 'pass-wins' ? 'Pass wins; Don’t Pass loses.' : 'Don’t Pass wins; Pass loses.'} New bets open shortly.`;
}

function CrapsStake({ value, disabled, onChange }: { value: number; disabled: boolean; onChange(value: number): void }) {
  const labelId = useId();
  return <div className="casino-stake">
    <span id={labelId} className="casino-label">Your stake</span>
    <div role="group" aria-labelledby={labelId}>
      <button type="button" aria-label="Decrease stake" disabled={disabled || value <= CASINO_MIN_STAKE} onClick={() => onChange(Math.max(CASINO_MIN_STAKE, value - CASINO_STAKE_STEP))}>−</button>
      <output aria-live="polite">{value}<span>credits</span></output>
      <button type="button" aria-label="Increase stake" disabled={disabled || value >= CASINO_MAX_STAKE} onClick={() => onChange(Math.min(CASINO_MAX_STAKE, value + CASINO_STAKE_STEP))}>+</button>
    </div>
    <span className="casino-stake-range">{CASINO_MIN_STAKE}–{CASINO_MAX_STAKE} · steps of {CASINO_STAKE_STEP}</span>
  </div>;
}

export function CrapsGame({ table, now, profileId, balance, privateState, busy, send, actionHost }: CrapsGameProps) {
  const [stake, setStake] = useState(CASINO_MIN_STAKE);
  const [kind, setKind] = useState<CrapsBetKind>('pass');
  const actionReasonId = useId();
  const ownBet = privateState.crapsBets?.find(item => item.tableId === table.id && item.roundId === table.roundId)?.bet;
  const selectedKind = ownBet?.kind ?? kind;
  const selectedStake = ownBet?.stake ?? stake;
  const isShooter = table.shooter?.profileId === profileId;
  const shooterName = isShooter ? 'You' : table.shooter?.name ?? 'Waiting for a player';
  const deadline = effectiveDeadline(table);
  const betting = table.phase === 'betting' && table.point === null && now < deadline;
  const awaitingRoll = table.phase === 'awaiting-roll';
  const canBet = betting && !ownBet && !busy && balance >= stake;
  const canRoll = awaitingRoll && isShooter && !busy && now < deadline;
  // Motion includes the final dice before they land. Only the published result may reveal them.
  const result = table.phase === 'result' ? table.result : null;
  const returned = result && result.pointAfter === null && ownBet ? crapsReturn(ownBet, result) : null;
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  const phaseLabel = table.phase === 'betting' ? 'Place your line bet'
    : awaitingRoll ? isShooter ? 'Your turn to roll' : 'Waiting for the shooter'
      : table.phase === 'rolling' ? 'Dice in motion'
        : table.phase === 'result' ? 'The dice have landed' : 'Table paused';
  const actionLabel = busy ? 'Waiting for the table…'
    : table.phase === 'paused' ? 'Table paused'
      : table.phase === 'rolling' ? 'Roll in progress'
        : table.phase === 'result' ? result?.pointAfter != null ? 'Next roll shortly' : 'Next round shortly'
          : awaitingRoll ? remaining === 0 ? 'Automatic roll pending' : isShooter ? 'Roll dice' : 'Waiting for shooter'
            : ownBet ? 'Bet placed' : !betting ? 'Betting closed' : balance < stake ? 'Not enough credits' : `Bet ${credits(stake)} on ${lineName(kind)}`;
  const actionReason = table.phase === 'paused' ? 'Play resumes when the table is ready. Accepted bets remain in play.'
    : table.phase === 'rolling' ? 'Watch the dice on the table. Bets stay locked until the roll resolves.'
      : table.phase === 'result' ? returned !== null ? `${credits(returned)} credits returned from your ${credits(selectedStake)} credit stake.` : result?.pointAfter != null ? `Point ${result.pointAfter} is active. Accepted bets stay in play.` : 'The next betting window opens shortly.'
        : awaitingRoll ? isShooter ? 'Roll when ready. The table rolls automatically when the timer ends.' : `${table.shooter ? `${shooterName} is the shooter.` : 'Waiting for a shooter.'} The table rolls automatically when the timer ends.`
          : ownBet ? 'Your line is accepted. Betting closes before the shooter can roll.'
            : !betting ? 'Waiting for the table to close betting.'
              : balance < stake ? 'Lower your stake or wait until you have enough credits.'
                : 'Choose one line for this cycle. Your bet stays in play until it resolves.';
  const controls = <>
    <CrapsStake value={selectedStake} onChange={setStake} disabled={busy || !betting || !!ownBet} />
    <button type="button" className="casino-primary craps-primary" aria-describedby={actionReasonId} disabled={!canBet && !canRoll} onClick={() => {
      if (canRoll) send({ action: 'craps-roll', tableId: table.id, roundId: table.roundId, rollId: table.rollId });
      else if (canBet) send({ action: 'craps-bet', tableId: table.id, roundId: table.roundId, bet: { kind, stake } });
    }}>{actionLabel}</button>
  </>;
  const returnSummary = returned !== null ? `${credits(returned)} returned` : `${credits(selectedStake * 2)} return if won`;

  return <div className="craps-game" data-phase={table.phase}>
    <p className="sr-only" role="status" aria-atomic="true">{phaseLabel}. {table.shooter ? `${shooterName}${isShooter ? ' are' : ' is'} the shooter.` : 'A bettor will become the shooter.'} {result ? `${result.dice[0]} plus ${result.dice[1]} equals ${result.total}. ${resultHeading(result)}. ${resultExplanation(result)}` : table.point === null ? 'No point set.' : `Point ${table.point} is active.`} {returned !== null ? `${credits(returned)} credits returned from your stake.` : ownBet ? `${lineName(ownBet.kind)}, ${credits(ownBet.stake)} credits in play.` : ''}</p>
    <div className="casino-round-status">
      <span><i aria-hidden="true" />{phaseLabel}</span>
      {deadline > 0 && table.phase !== 'paused' && <span className="casino-countdown" aria-label={remaining ? `${awaitingRoll ? 'Automatic roll' : table.phase === 'betting' ? 'Betting closes' : 'Next phase'} in ${remaining} seconds` : 'Waiting for the table'}>{remaining ? `${remaining}s` : 'Waiting…'}</span>}
    </div>

    <div className="craps-outcome">
      <div className="craps-dice" aria-hidden="true"><Die value={result?.dice[0]} /><Die value={result?.dice[1]} /></div>
      <div className="craps-outcome-copy">
        <span className="casino-label">{result ? 'DICE TOTAL' : table.phase === 'rolling' ? 'WATCH THE TABLE' : table.point === null ? 'OPENING ROLL' : 'POINT IN PLAY'}</span>
        <strong>{result ? <><span className="craps-total">{result.total}</span>{resultHeading(result)}</> : table.phase === 'rolling' ? 'Rolling…' : table.point === null ? 'A new chance.' : `Make ${table.point} before 7.`}</strong>
        <p>{result ? `${result.dice[0]} + ${result.dice[1]} = ${result.total}. ${resultExplanation(result)}` : table.point === null ? '7 or 11 wins Pass. 2 or 3 wins Don’t Pass.' : `Pass needs ${table.point}; Don’t Pass needs 7. Other totals keep the point in play.`}</p>
      </div>
    </div>

    <p className="craps-table-status"><span>Shooter <strong>{shooterName}</strong></span><span>{table.point===null?'Opening roll':`Point ${table.point}`} · {table.betCount} bets</span></p>
    <fieldset className="craps-line-choice" disabled={busy || !betting || !!ownBet}>
      <legend>{ownBet ? 'Your accepted line' : 'Choose your line'}</legend>
      <div>{(['pass', 'dont-pass'] as const).map(line => <button key={line} type="button" aria-pressed={selectedKind === line} onClick={() => setKind(line)}><strong>{lineName(line)}</strong><small>{line === 'pass' ? 'Point before 7' : '7 before the point'}</small></button>)}</div>
    </fieldset>

    <p id={actionReasonId} className="casino-instruction craps-action-reason">{actionReason}</p>

    {actionHost ? createPortal(<div className="casino-action-dock craps-action-dock">
      <div className="casino-dock-summary"><span className="casino-dock-selection">{lineName(selectedKind)}<small>{ownBet ? `${credits(selectedStake)} credits ${returned === null ? 'in play' : 'staked'}` : table.point === null ? 'Opening roll' : `Point ${table.point}`}</small></span><span className="casino-dock-return">{returnSummary}<small>{returned !== null ? 'Result includes stake' : 'Includes your stake'}</small></span><RoundReady table={table} profileId={profileId} eligible={!!ownBet} busy={busy} now={now} send={send}/></div>
      <div className="casino-dock-controls">{controls}</div>
    </div>, actionHost) : <div className="craps-controls">
      <div className="casino-return-line"><span>{returned === null ? 'Return if it wins' : 'Your return'}<small>including stake</small></span><strong>{credits(returned ?? selectedStake * 2)} credits</strong></div>
      {controls}
    </div>}

  </div>;
}
