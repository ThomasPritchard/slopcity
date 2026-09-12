import { useCallback, useEffect, useRef, useState } from 'react';
import { SUBMISSION_PROTECTION as LIMITS, type SubmissionProtectionSnapshot } from '../../shared/submissionProtection';
import { CommunityApiError, communityError, communityRequest } from './api';

const events: Record<string, string> = {
 'manual-paused': 'Player submissions paused by the review desk', 'manual-resumed': 'Manual pause cleared',
 'backlog-paused': 'Player submissions paused for the review backlog', 'backlog-resumed': 'Review backlog cleared',
 'spam-paused': 'Player submissions paused after unusual upload activity', 'trial-started': 'Gradual reopening started', 'trial-completed': 'Normal upload allowance restored',
 'accountCooldowns-started': 'Account upload cooldown started', 'accountCooldowns-expired': 'Account upload cooldown ended',
 'networkCooldowns-started': 'Connection upload cooldown started', 'networkCooldowns-expired': 'Connection upload cooldown ended',
 'account-cooldown-cleared': 'Account upload cooldown cleared by the review desk',
};
function remaining(until: number, now: number) {
 const seconds = Math.max(0, Math.ceil((until - now) / 1000));
 return seconds === 0 ? 'checking shortly' : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export function SubmissionControls({ pendingCount, onSessionExpired }: { pendingCount: number; onSessionExpired(): void }) {
 const [snapshot, setSnapshot] = useState<SubmissionProtectionSnapshot | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
 const [busy, setBusy] = useState(false), [now, setNow] = useState(Date.now);
 const request = useRef<AbortController | null>(null), mutating = useRef(false);
 const refresh = useCallback(async () => {
  if (mutating.current) return;
  request.current?.abort(); const controller = new AbortController(); request.current = controller;
  try { const next = await communityRequest<SubmissionProtectionSnapshot>('/admin/submissions', { signal: controller.signal }); if (!controller.signal.aborted) { setSnapshot(next); setError(''); } }
  catch (cause) { if (controller.signal.aborted) return; if (cause instanceof CommunityApiError && cause.status === 401) { setSnapshot(null); onSessionExpired(); } else setError(communityError(cause)); }
 }, [onSessionExpired]);
 useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15_000); return () => { clearInterval(timer); request.current?.abort(); }; }, [refresh, pendingCount]);
 useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(timer); }, []);
 async function change(action: 'pause' | 'resume' | 'clear-cooldown', profileId?: string) {
  if (mutating.current) return;
  mutating.current = true; request.current?.abort(); setBusy(true); setError(''); setNotice('');
  try {
   const next = await communityRequest<SubmissionProtectionSnapshot>('/admin/submissions', { method: 'PATCH', body: JSON.stringify({ action, ...(profileId ? { profileId } : {}) }) });
   setSnapshot(next);
   setNotice(action === 'pause' ? 'Manual pause enabled. Review and moderation remain available.' : action === 'resume' ? (next.reasons.length ? 'Manual pause cleared. Automatic protection is still active.' : 'Manual pause cleared. Player submissions are open.') : 'Account cooldown cleared. Any connection cooldown and automatic protection still apply.');
  } catch (cause) { if (cause instanceof CommunityApiError && cause.status === 401) { setSnapshot(null); onSessionExpired(); } else setError(communityError(cause)); }
  finally { mutating.current = false; setBusy(false); }
 }
 return <section className="submission-controls" aria-label="Submission protection">
  <div className="submission-controls-heading"><div><span className="community-kicker">SUBMISSION PROTECTION</span><h4>{!snapshot ? 'Checking the queue…' : snapshot.pending >= LIMITS.pendingHardCap ? 'The review queue is full.' : snapshot.reasons.length ? 'Player submissions are paused.' : snapshot.trialUntil ? 'Reopening carefully.' : 'Player submissions are open.'}</h4></div>
   {snapshot && <p className="submission-count"><strong>{snapshot.pending}</strong><span> / {LIMITS.pendingHardCap} pending images</span></p>}
  </div>
  {error && <p className="community-error" role="alert">{error} <button type="button" disabled={busy} onClick={() => void refresh()}>Retry</button></p>}
  {snapshot && <>
   <ul className="submission-reasons">
    {snapshot.manualPaused && <li><strong>Manual pause.</strong> Clear it below when you are ready. Automatic protection will still apply.</li>}
    {snapshot.backlogPaused && <li><strong>Review backlog.</strong> Player submissions reopen when the queue drops to {LIMITS.backlogResume} pending images or fewer, once any other pause has cleared.</li>}
    {snapshot.spamPauseUntil && <li><strong>Unusual upload activity.</strong> The automatic pause is due to end in {remaining(snapshot.spamPauseUntil, now)}. The queue will then reopen gradually.</li>}
    {snapshot.trialUntil && <li><strong>Gradual reopening.</strong> At most {LIMITS.trialAdmissions} player images per minute until {new Date(snapshot.trialUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({remaining(snapshot.trialUntil, now)}). Any active pause must also clear.</li>}
   </ul>
   <p className="community-help">{snapshot.pending >= LIMITS.pendingHardCap ? 'Review some pending images before anyone can add more, including promos.' : 'You can keep reviewing images and uploading promos during a player submission pause.'}</p>
   <div className="submission-control-actions"><button type="button" className={snapshot.manualPaused ? 'community-secondary' : 'community-button'} disabled={busy} onClick={() => void change(snapshot.manualPaused ? 'resume' : 'pause')}>{busy ? 'Saving…' : snapshot.manualPaused ? 'Clear manual pause' : 'Pause player submissions'}</button></div>
   {notice && <p className="community-notice" role="status">{notice}</p>}
   {(snapshot.accountCooldowns.length > 0 || snapshot.networkCooldowns.length > 0) && <details className="submission-control-details" open><summary>Upload cooldowns ({snapshot.accountCooldowns.length + snapshot.networkCooldowns.length})</summary>
    {snapshot.accountCooldowns.length > 0 && <ul className="submission-cooldowns">{snapshot.accountCooldowns.map(cooldown => <li key={cooldown.key}><div><span>Account</span><code>{cooldown.key}</code><small>{remaining(cooldown.until, now)} remaining</small></div><button type="button" className="community-secondary" disabled={busy} aria-label={`Clear upload cooldown for account ${cooldown.key}`} onClick={() => void change('clear-cooldown', cooldown.key)}>Clear cooldown</button></li>)}</ul>}
    {snapshot.networkCooldowns.length > 0 && <><p className="community-help">Connection cooldowns expire automatically. Clearing an account cooldown does not clear its connection cooldown.</p><ul className="submission-cooldowns">{snapshot.networkCooldowns.map(cooldown => <li key={cooldown.key}><div><span>Connection</span><code>{cooldown.key}</code><small>{remaining(cooldown.until, now)} remaining</small></div></li>)}</ul></>}
   </details>}
   <details className="submission-control-details"><summary>Automatic protection rules</summary><p>A player must have a verified email account and complete a fresh check for every image.</p><ul className="submission-reasons"><li>{LIMITS.accountThreshold} distinct invalid or duplicate attempts within two minutes pause that account’s uploads for 15 minutes. {LIMITS.networkThreshold} pause that connection.</li><li>{LIMITS.globalThreshold} qualifying attempts from at least {LIMITS.globalAccounts} accounts and {LIMITS.globalNetworks} connections within two minutes pause player submissions for ten minutes.</li><li>After that pause, the queue reopens with up to {LIMITS.trialAdmissions} player images per minute for five minutes. Another qualifying incident restarts the pause.</li><li>The review backlog pauses player submissions at {LIMITS.backlogPause} pending images and reopens at {LIMITS.backlogResume}. The hard limit is {LIMITS.pendingHardCap} pending images.</li></ul><p className="community-help">Guests, failed verification checks, ordinary retries and attempts blocked by existing limits do not trigger or extend a town-wide spam pause.</p></details>
   <details className="submission-control-details"><summary>Recent protection activity</summary>{snapshot.history.length ? <ol className="submission-history">{[...snapshot.history].reverse().map((entry, index) => <li key={`${entry.at}:${entry.event}:${index}`}><time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString()}</time><span>{events[entry.event] ?? 'Submission protection updated'}</span>{entry.scope && <code>{entry.scope}</code>}</li>)}</ol> : <p>No protection changes recorded yet.</p>}</details>
  </>}
 </section>;
}
