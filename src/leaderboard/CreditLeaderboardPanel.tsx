import { useEffect, useRef } from 'react';
import type { CreditLeaderboard } from '../../shared/creditLeaderboard';
import '../social/social.css';
import './leaderboard.css';

export function CreditLeaderboardPanel({ snapshot, unavailable, onClose }: { snapshot: CreditLeaderboard | null; unavailable: boolean; onClose(): void }) {
 const close = useRef<HTMLButtonElement>(null);
 useEffect(() => {
  const previous = document.activeElement;
  close.current?.focus({ preventScroll: true });
  const key = (event: KeyboardEvent) => {
   if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current?.click(); }
   if (event.key === 'Tab') { event.preventDefault(); close.current?.focus(); }
  };
  document.addEventListener('keydown', key, true);
  return () => { document.removeEventListener('keydown', key, true); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); else document.getElementById('world')?.focus({ preventScroll: true }); };
 }, []);
 return <div className="social-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) event.preventDefault(); }}>
  <section className="social-panel credit-leaderboard" role="dialog" aria-modal="true" aria-labelledby="credit-leaderboard-title">
   <header className="social-header"><div><span className="eyebrow">THE MERIDIAN · RECEPTION</span><h2 id="credit-leaderboard-title">Credit leaderboard</h2><p className="social-copy">The ten richest neighbours in Slop City.</p></div><button ref={close} type="button" className="social-close" aria-label="Close credit leaderboard" onClick={onClose}>×</button></header>
   <div className="social-content credit-leaderboard-content">
    {!snapshot ? <p className="social-copy" role="status">{unavailable ? 'The leaderboard is taking a moment. Please check again shortly.' : 'Finding the richest neighbours…'}</p> : snapshot.entries.length === 0 ? <p className="social-copy">The first fortunes are still being made.</p> : <table><caption className="sr-only">Ranked by wallet credits and saved poker chips</caption><thead><tr><th scope="col">Rank</th><th scope="col">Neighbour</th><th scope="col">Credits</th></tr></thead><tbody>{snapshot.entries.map((entry, index) => <tr key={index} className={entry.rank === 1 ? 'is-leading' : undefined}><td>{entry.rank.toString().padStart(2, '0')}</td><th scope="row">{entry.name}</th><td>{entry.credits.toLocaleString('en-GB')}</td></tr>)}</tbody></table>}
   </div>
   <footer className="credit-leaderboard-footer"><p>Wallet credits + poker chips. Equal fortunes share a rank.</p><p>{unavailable ? snapshot ? 'Updates are delayed. Showing the last available standings.' : 'Please check again shortly.' : 'Updates every 30 seconds. Poker hands count when settled.'}</p></footer>
  </section>
 </div>;
}
