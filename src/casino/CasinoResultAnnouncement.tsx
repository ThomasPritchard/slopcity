import { useEffect, useRef, useState } from 'react';
import type { CasinoPrivateState, CasinoState } from '../../shared/casino';
import { CasinoResultFeed, type CasinoResult } from './casinoResults';
import './casino-result.css';

export function CasinoResultAnnouncement({ state, privateState, profileId, atTable, onResults }: { state: CasinoState; privateState: CasinoPrivateState; profileId: string; atTable: boolean; onResults?(results: CasinoResult[]): void }) {
  const feed = useRef(new CasinoResultFeed());
  const [queue, setQueue] = useState<CasinoResult[]>([]);
  useEffect(() => {
    const incoming = feed.current.collect(state.tables, privateState, profileId);
    if (incoming.length) { setQueue(previous => [...previous, ...incoming]); onResults?.(incoming); }
  }, [state, privateState, profileId, onResults]);
  const result = queue[0];
  useEffect(() => {
    if (!result) return;
    const timeout = window.setTimeout(() => setQueue(previous => previous.slice(1)), 2400);
    return () => window.clearTimeout(timeout);
  }, [result]);
  const tone = result ? result.net > 0 ? 'win' : result.net < 0 ? 'loss' : 'push' : '';
  return <div className={`casino-result-region${atTable ? ' is-at-table' : ''}`} role="status" aria-live="polite" aria-atomic="true">
    {result && <div key={result.id} className={`casino-result-announcement is-${tone}`} data-result-id={result.id} data-net={result.net}>
      <span className="casino-result-detail">{result.detail}</span>
      <strong>{tone === 'win' ? 'You won' : tone === 'loss' ? 'Round lost' : 'Stake returned'}</strong>
      <span className="casino-result-amount">{result.net > 0 ? '+' : result.net < 0 ? '−' : ''}{Math.abs(result.net).toLocaleString('en-GB')} {result.unit}</span>
      <small>{result.returned.toLocaleString('en-GB')} returned · {result.stake.toLocaleString('en-GB')} staked</small>
    </div>}
  </div>;
}
