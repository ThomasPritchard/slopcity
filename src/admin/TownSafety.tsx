import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { SafetyBan, SafetyGuest, SafetySnapshot } from '../../shared/safety';
import { CommunityApiError, communityError, communityRequest } from '../community/api';
import './town-safety.css';

type BanDraft = { kind: 'ip' | 'guest'; target: string; reason: string; durationMinutes: number | null };
const DURATIONS = [{ value: 60, label: '1 hour' }, { value: 1440, label: '1 day' }, { value: 10080, label: '1 week' }, { value: null, label: 'Permanent' }];
const formatTime = (value: number) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const label = (value: string) => value.replace(/[_.:-]+/g, ' ').replace(/^\w/, first => first.toUpperCase());
const durationLabel = (minutes: number | null) => DURATIONS.find(item => item.value === minutes)?.label ?? `${minutes} minutes`;

export function TownSafety({ onSessionExpired }: { onSessionExpired(): void }) {
 const [snapshot, setSnapshot] = useState<SafetySnapshot | null>(null);
 const [loading, setLoading] = useState(true), [snapshotError, setSnapshotError] = useState('');
 const [query, setQuery] = useState(''), [searchedQuery, setSearchedQuery] = useState('');
 const [guests, setGuests] = useState<SafetyGuest[] | null>(null), [searching, setSearching] = useState(false), [searchError, setSearchError] = useState('');
 const [draft, setDraft] = useState<BanDraft>({ kind: 'guest', target: '', reason: '', durationMinutes: 1440 });
 const [review, setReview] = useState<BanDraft | null>(null), [lifting, setLifting] = useState<string | null>(null);
 const [busy, setBusy] = useState(false), [actionError, setActionError] = useState(''), [notice, setNotice] = useState('');
 const mounted = useRef(false), mutating = useRef(false);
 const snapshotRequest = useRef<AbortController | null>(null), searchRequest = useRef<AbortController | null>(null), actionRequest = useRef<AbortController | null>(null);
 const targetInput = useRef<HTMLInputElement>(null), reviewHeading = useRef<HTMLHeadingElement>(null), feedback = useRef<HTMLParagraphElement>(null);
 const id = useId();

 const expired = useCallback((cause: unknown) => {
  if (!(cause instanceof CommunityApiError) || cause.status !== 401) return false;
  snapshotRequest.current?.abort(); searchRequest.current?.abort(); actionRequest.current?.abort();
  setSnapshot(null); setGuests(null); setDraft({ kind: 'guest', target: '', reason: '', durationMinutes: 1440 });
  setReview(null); setLifting(null); setNotice(''); setActionError(''); setSearchError('');
  onSessionExpired();
  return true;
 }, [onSessionExpired]);

 const refresh = useCallback(async () => {
  if (!mounted.current || document.visibilityState !== 'visible' || snapshotRequest.current || mutating.current) return;
  const controller = new AbortController(); snapshotRequest.current = controller;
  const timeout = window.setTimeout(() => controller.abort('timeout'), 15_000);
  setLoading(true);
  try {
   const value = await communityRequest<SafetySnapshot>('/admin/safety', { signal: controller.signal });
   if (mounted.current && !controller.signal.aborted) { setSnapshot(value); setSnapshotError(''); }
  } catch (cause) {
   if (!mounted.current || (controller.signal.aborted && controller.signal.reason !== 'timeout')) return;
   setSnapshot(null);
   if (!expired(cause)) setSnapshotError(controller.signal.reason === 'timeout' ? 'The safety desk took too long to respond. Try refreshing.' : communityError(cause));
  } finally {
   window.clearTimeout(timeout);
   if (snapshotRequest.current === controller) { snapshotRequest.current = null; if (mounted.current) setLoading(false); }
  }
 }, [expired]);

 useEffect(() => {
  mounted.current = true;
  void refresh();
  const interval = window.setInterval(() => void refresh(), 10_000);
  const visibilityChanged = () => {
   // A returning administrator must see a fresh snapshot, including a fresh session check.
   setSnapshot(null);
   snapshotRequest.current?.abort(); snapshotRequest.current = null;
   if (document.visibilityState === 'visible') void refresh();
  };
  document.addEventListener('visibilitychange', visibilityChanged);
  return () => {
   mounted.current = false; window.clearInterval(interval);
   document.removeEventListener('visibilitychange', visibilityChanged);
   snapshotRequest.current?.abort(); snapshotRequest.current = null;
   searchRequest.current?.abort(); actionRequest.current?.abort();
  };
 }, [refresh]);

 useEffect(() => { if (review) reviewHeading.current?.focus(); }, [review]);
 useEffect(() => { if (actionError || notice) feedback.current?.focus(); }, [actionError, notice]);

 const chooseTarget = (kind: BanDraft['kind'], target: string) => {
  setDraft(current => ({ ...current, kind, target })); setReview(null); setActionError(''); setNotice('');
  window.requestAnimationFrame(() => targetInput.current?.focus());
 };
 const search = async (event: FormEvent) => {
  event.preventDefault(); const term = query.trim(); if (!term || searching) return;
  searchRequest.current?.abort();
  const controller = new AbortController(); searchRequest.current = controller;
  const timeout = window.setTimeout(() => controller.abort('timeout'), 15_000);
  setSearching(true); setGuests(null); setSearchError(''); setSearchedQuery(term);
  try {
   const result = await communityRequest<{ guests: SafetyGuest[] }>(`/admin/safety/guests?q=${encodeURIComponent(term)}`, { signal: controller.signal });
   if (mounted.current && !controller.signal.aborted) setGuests(result.guests);
  } catch (cause) {
   if (!mounted.current || (controller.signal.aborted && controller.signal.reason !== 'timeout')) return;
   if (!expired(cause)) setSearchError(controller.signal.reason === 'timeout' ? 'Guest search took too long. Please try again.' : communityError(cause));
  } finally {
   window.clearTimeout(timeout);
   if (searchRequest.current === controller) { searchRequest.current = null; if (mounted.current) setSearching(false); }
  }
 };
 const reviewBan = (event: FormEvent) => {
  event.preventDefault();
  const target = draft.target.trim(), reason = draft.reason.trim();
  if (!target || !reason) { setActionError('Enter an exact target and a reason for this ban.'); return; }
  setActionError(''); setNotice(''); setReview({ ...draft, target, reason });
 };
 const changeBan = async (ban: BanDraft | SafetyBan, lift: boolean) => {
  if (mutating.current) return;
  mutating.current = true; setBusy(true); setActionError(''); setNotice('');
  snapshotRequest.current?.abort(); snapshotRequest.current = null;
  const controller = new AbortController(); actionRequest.current = controller;
  const timeout = window.setTimeout(() => controller.abort('timeout'), 15_000);
  try {
   if (lift && 'id' in ban) await communityRequest(`/admin/safety/bans/${encodeURIComponent(ban.id)}`, { method: 'DELETE', signal: controller.signal });
   else await communityRequest('/admin/safety/bans', { method: 'POST', body: JSON.stringify(ban), signal: controller.signal });
   if (!mounted.current || controller.signal.aborted) return;
   setNotice(lift ? `Ban lifted for ${ban.target}.` : `${ban.kind === 'ip' ? 'IP' : 'Guest'} ban added for ${ban.target}.`);
   if (!lift) { setReview(null); setDraft(current => ({ ...current, target: '', reason: '' })); }
   setLifting(null);
  } catch (cause) {
   if (!mounted.current || (controller.signal.aborted && controller.signal.reason !== 'timeout')) return;
   if (!expired(cause)) setActionError(controller.signal.reason === 'timeout' ? 'The request timed out. Check the refreshed bans before trying again.' : communityError(cause));
  } finally {
   window.clearTimeout(timeout); actionRequest.current = null; mutating.current = false;
   if (mounted.current && !controller.signal.aborted) { setBusy(false); setSnapshot(null); await refresh(); }
   else if (mounted.current && controller.signal.reason === 'timeout') { setBusy(false); setSnapshot(null); await refresh(); }
  }
 };

 return <section className="town-safety" aria-labelledby={`${id}-title`}>
  <div className="town-safety-heading"><div><span className="community-kicker">PRIVATE ADMINISTRATION</span><h2 id={`${id}-title`}>Town safety</h2><p>Review activity, find guests and manage access to the town.</p></div><button type="button" className="community-secondary" disabled={loading || busy} onClick={() => void refresh()}>{loading ? 'Refreshing…' : 'Refresh activity'}</button></div>
  <p className="town-safety-sync">Updates every 10 seconds while this page is visible.{snapshot && <> Last updated <time dateTime={new Date(snapshot.now).toISOString()}>{formatTime(snapshot.now)}</time>.</>}</p>
  {snapshotError && <p className="community-error" role="alert">{snapshotError} Activity is unavailable until a refresh succeeds.</p>}
  {loading && !snapshot && <p className="town-safety-empty" role="status">Loading current activity…</p>}
  {notice && <p ref={feedback} tabIndex={-1} className="community-notice" role="status">{notice}</p>}
  {actionError && <p ref={feedback} tabIndex={-1} className="community-error" role="alert">{actionError}</p>}

  {snapshot && <section className="town-safety-section" aria-labelledby={`${id}-players`}>
   <div className="town-safety-section-title"><h3 id={`${id}-players`}>In the town <span>{snapshot.players.length}</span></h3><p>Current connected players</p></div>
   {snapshot.players.length ? <ul className="town-safety-list">{snapshot.players.map(player => <li key={player.sessionId} className="town-safety-player"><div className="town-safety-identity"><strong>{player.name}</strong><span>Guest <code>{player.profileId}</code></span><span>IP <code>{player.ip}</code></span><small>Joined {formatTime(player.joinedAt)}</small></div><div className="town-safety-actions"><button type="button" className="community-secondary" disabled={busy} aria-label={`Ban guest ${player.name}`} onClick={() => chooseTarget('guest', player.profileId)}>Ban guest</button><button type="button" className="community-secondary" disabled={busy} aria-label={`Ban IP for ${player.name}`} onClick={() => chooseTarget('ip', player.ip)}>Ban IP</button></div></li>)}</ul> : <p className="town-safety-empty">No players are connected.</p>}
  </section>}

  <div className="town-safety-tools">
   <section className="town-safety-section" aria-labelledby={`${id}-search`}>
    <h3 id={`${id}-search`}>Find a guest</h3><p className="town-safety-description">Search saved guests by name or guest ID, including those who have left.</p>
    <form className="community-form town-safety-search" aria-label="Find a guest" onSubmit={event => void search(event)}><label>Name or guest ID<input type="search" value={query} required maxLength={100} autoComplete="off" onChange={event => { setQuery(event.target.value); setGuests(null); setSearchError(''); searchRequest.current?.abort(); searchRequest.current = null; setSearching(false); }}/></label><button type="submit" className="community-secondary" disabled={!query.trim() || searching}>{searching ? 'Searching…' : 'Search guests'}</button></form>
    {searchError && <p className="community-error" role="alert">{searchError}</p>}
    {guests && <><p className="town-safety-search-count" role="status">{guests.length ? `${guests.length} ${guests.length === 1 ? 'result' : 'results'}` : 'No guests found'} for “{searchedQuery}”.</p><ul className="town-safety-list town-safety-guests">{guests.map(guest => <li key={guest.profileId}><div className="town-safety-identity"><strong>{guest.name}</strong><code>{guest.profileId}</code><small>First joined {formatTime(guest.createdAt)}</small></div><button type="button" className="community-secondary" disabled={busy} aria-label={`Ban saved guest ${guest.name}`} onClick={() => chooseTarget('guest', guest.profileId)}>Ban guest</button></li>)}</ul></>}
   </section>
   <section className="town-safety-section" aria-labelledby={`${id}-ban`}>
    <h3 id={`${id}-ban`}>Add a ban</h3><p className="town-safety-description">Choose a player above or enter an exact IP address or guest ID.</p>
    {!review ? <form className="community-form town-safety-ban-form" aria-label="Add a ban" onSubmit={reviewBan}><fieldset disabled={busy}><div className="community-form-row"><label>Ban type<select aria-label="Ban type" value={draft.kind} onChange={event => setDraft(current => ({ ...current, kind: event.target.value as BanDraft['kind'], target: '' }))}><option value="guest">Guest ID</option><option value="ip">IP address</option></select></label><label>Duration<select aria-label="Duration" value={draft.durationMinutes ?? 'permanent'} onChange={event => setDraft(current => ({ ...current, durationMinutes: event.target.value === 'permanent' ? null : Number(event.target.value) }))}>{DURATIONS.map(item => <option key={item.value ?? 'permanent'} value={item.value ?? 'permanent'}>{item.label}</option>)}</select></label></div><label>{draft.kind === 'ip' ? 'Exact IP address' : 'Exact guest ID'}<input ref={targetInput} value={draft.target} required maxLength={128} spellCheck={false} autoCapitalize="none" autoComplete="off" placeholder={draft.kind === 'ip' ? 'IPv4 or IPv6 address' : 'Guest UUID'} aria-describedby={`${id}-target-help`} onChange={event => setDraft(current => ({ ...current, target: event.target.value }))}/></label><p id={`${id}-target-help`} className="community-help">{draft.kind === 'ip' ? 'An IP ban affects everyone using that address. Shared networks may include other players.' : 'A guest ban applies to this saved guest profile. Use the ID to distinguish players with the same name.'}</p><label>Reason<textarea aria-label="Reason" required maxLength={240} rows={3} value={draft.reason} placeholder="Describe the behaviour that led to this ban" onChange={event => setDraft(current => ({ ...current, reason: event.target.value }))}/></label></fieldset><button type="submit" className="community-button" disabled={busy || !draft.target.trim() || !draft.reason.trim()}>Review ban</button></form> : <div className="town-safety-confirm"><h4 ref={reviewHeading} tabIndex={-1}>Review this {review.kind === 'ip' ? 'IP' : 'guest'} ban</h4><dl><div><dt>Target</dt><dd><code>{review.target}</code></dd></div><div><dt>Duration</dt><dd>{durationLabel(review.durationMinutes)}</dd></div><div><dt>Reason</dt><dd>{review.reason}</dd></div></dl><p>{review.kind === 'ip' ? 'This will block everyone using this IP address, including players on a shared household, workplace or mobile network.' : 'This will block this saved guest profile from entering the town.'}{review.durationMinutes === null && ' This ban remains active until you lift it.'}</p><div className="town-safety-actions"><button type="button" className="community-button town-safety-danger" disabled={busy} onClick={() => void changeBan(review, false)}>{busy ? 'Adding ban…' : 'Confirm ban'}</button><button type="button" className="community-secondary" disabled={busy} onClick={() => { setReview(null); window.requestAnimationFrame(() => targetInput.current?.focus()); }}>Edit ban</button></div></div>}
   </section>
  </div>

  {snapshot && <>
   <section className="town-safety-section" aria-labelledby={`${id}-bans`}><div className="town-safety-section-title"><h3 id={`${id}-bans`}>Active bans <span>{snapshot.bans.length}</span></h3><p>Temporary bans expire automatically.</p></div>{snapshot.bans.length ? <ul className="town-safety-list">{snapshot.bans.map(ban => <li key={ban.id} className="town-safety-ban"><div className="town-safety-identity"><strong>{ban.kind === 'ip' ? 'IP address' : 'Guest profile'}</strong><code>{ban.target}</code><p>{ban.reason}</p><small>Added {formatTime(ban.createdAt)} · {ban.expiresAt === null ? 'Permanent' : `Expires ${formatTime(ban.expiresAt)}`}</small></div>{lifting === ban.id ? <div className="town-safety-lift"><p>Allow this {ban.kind === 'ip' ? 'IP address' : 'guest profile'} to enter again?</p><div className="town-safety-actions"><button type="button" className="community-button" disabled={busy} onClick={() => void changeBan(ban, true)}>{busy ? 'Lifting ban…' : 'Confirm lift'}</button><button type="button" className="community-secondary" disabled={busy} onClick={() => setLifting(null)}>Keep ban</button></div></div> : <button type="button" className="community-secondary" disabled={busy} aria-label={`Lift ban for ${ban.target}`} onClick={() => { setLifting(ban.id); setActionError(''); setNotice(''); }}>Lift ban</button>}</li>)}</ul> : <p className="town-safety-empty">No active bans.</p>}</section>

   <section className="town-safety-section" aria-labelledby={`${id}-metrics`}><h3 id={`${id}-metrics`}>Activity counters</h3><p className="town-safety-description">Counts since this server process started at {formatTime(snapshot.startedAt)}. They reset on restart.</p>{snapshot.metrics.length ? <dl className="town-safety-metrics">{snapshot.metrics.map(metric => <div key={metric.name}><dt>{label(metric.name)}</dt><dd>{metric.count.toLocaleString()}</dd></div>)}</dl> : <p className="town-safety-empty">No activity has been recorded.</p>}</section>
   <section className="town-safety-section" aria-labelledby={`${id}-events`}><h3 id={`${id}-events`}>Recent signals</h3><p className="town-safety-description">These events are signals to investigate, not confirmed bots or proof of abuse.</p>{snapshot.recentEvents.length ? <ol className="town-safety-list town-safety-events">{snapshot.recentEvents.map((event, index) => <li key={`${event.at}:${event.type}:${index}`}><time dateTime={new Date(event.at).toISOString()}>{formatTime(event.at)}</time><div className="town-safety-identity"><strong>{label(event.type)} <span className="town-safety-event-count">×{event.count.toLocaleString()}</span></strong>{event.ip && <span>IP <code>{event.ip}</code></span>}{event.profileId && <span>Guest <code>{event.profileId}</code></span>}</div></li>)}</ol> : <p className="town-safety-empty">No recent signals.</p>}</section>
   <section className="town-safety-section" aria-labelledby={`${id}-limits`}><h3 id={`${id}-limits`}>Configured limits</h3><dl className="town-safety-limits">{snapshot.limits.map(limit => <div key={limit.name}><dt>{label(limit.name)}</dt><dd>{limit.value}</dd></div>)}</dl></section>
  </>}
 </section>;
}
