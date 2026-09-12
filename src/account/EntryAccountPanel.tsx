import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AccountEntryResult, AccountStatus } from '../../shared/account';
import { TurnstileWidget } from '../social/TurnstileWidget';
import { AccountApiError, accountError, accountRequest } from './api';

type Props = { status: AccountStatus | null; loading: boolean; error: string; onRetry(): Promise<void>; onClose(): void; onComplete(result: AccountEntryResult): void };
type EntryAttempt = { key: string; requestId: string };

export function EntryAccountPanel({ status, loading, error, onRetry, onClose, onComplete }: Props) {
 const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
 const request = useRef<AbortController | null>(null), mounted = useRef(false), lastAttempt = useRef<EntryAttempt | null>(null);
 const titleId = useId(), emailId = useId(), emailHelpId = useId(), formId = useId();
 const [email, setEmail] = useState(''), [busy, setBusy] = useState<'guest' | 'save' | null>(null), [operationError, setOperationError] = useState('');
 const [token, setToken] = useState(''), [checkError, setCheckError] = useState(''), [attempt, setAttempt] = useState(0);
 const canEnter = !loading && !error && status?.kind === 'guest' && Boolean(status.profileId);
 const verificationReady = canEnter && (!status.challenge.enabled || Boolean(token));

 useEffect(() => {
  mounted.current = true;
  const node = dialog.current!, previous = document.activeElement;
  node.showModal(); heading.current?.focus({ preventScroll: true });
  return () => {
   mounted.current = false; request.current?.abort(); node.close();
   if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
   else document.getElementById('world')?.focus({ preventScroll: true });
  };
 }, []);
 async function submit(choice: 'guest' | 'save') {
  if (busy || !verificationReady || !status?.profileId || (choice === 'save' && (!status.emailEnabled || !email.trim()))) return;
  const payload = { expectedProfileId: status.profileId, choice, ...(choice === 'save' ? { email: email.trim() } : {}) };
  const key = JSON.stringify(payload), previous = lastAttempt.current;
  const current = previous?.key === key ? previous : { key, requestId: crypto.randomUUID() };
  lastAttempt.current = current;
  request.current?.abort(); const controller = new AbortController(); request.current = controller;
  setBusy(choice); setOperationError('');
  try {
   const result = await accountRequest<AccountEntryResult>('/entry', {
    method: 'POST', body: JSON.stringify({ ...payload, requestId: current.requestId, ...(token ? { turnstileToken: token } : {}) }),
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
   });
   if (!mounted.current || controller.signal.aborted) return;
   onComplete(result);
  } catch (cause) {
   if (!mounted.current || controller.signal.aborted) return;
   if (cause instanceof AccountApiError && cause.status >= 400 && cause.status < 500) lastAttempt.current = null;
   setOperationError(accountError(cause)); setToken(''); setAttempt(value => value + 1);
  } finally { if (mounted.current && !controller.signal.aborted) setBusy(null); }
 }
 function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void submit('save'); }

 return createPortal(<dialog ref={dialog} className="account-dialog account-entry-dialog" aria-labelledby={titleId}
  onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
  <header className="account-header"><div><span className="account-kicker">YOUR SLOP CITY ACCOUNT</span><h2 id={titleId} ref={heading} tabIndex={-1}>Save your progress?</h2></div>
   <button type="button" className="account-close" aria-label="Cancel joining" onClick={onClose}>×</button>
  </header>
  <div className="account-content">
   {loading ? <p role="status">Getting your guest ready…</p> : error || !status ? <><p className="account-error" role="alert">{error || 'Your guest could not be reached. Please try again.'}</p><button type="button" className="account-secondary" onClick={() => void onRetry()}>Try again</button></> : !canEnter ? <p className="account-notice" role="status">Your profile has changed. Close this window and join the square again.</p> : <div className="account-entry-grid">
    <div><p>Keep your credits, clothing and friends with an email account.</p>
     {status.emailEnabled ? <form id={formId} className="account-form" onSubmit={save} aria-label="Save your progress and join">
      <label htmlFor={emailId}>Email address</label><input id={emailId} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} disabled={Boolean(busy)} onChange={event => setEmail(event.target.value)} aria-describedby={emailHelpId} placeholder="you@example.com"/>
      <p id={emailHelpId} className="account-note">We’ll send a link to verify later. Already have an account? Use its email for a sign-in link. You can join now.</p>
     </form> : <p className="account-notice" role="status">Email accounts are not available yet. You can join as a guest and save your progress later.</p>}
    </div>
    {status.challenge.enabled && <section className="account-entry-check" aria-label="Entry verification"><h3>A quick check before you join.</h3>
     <p className="account-note">This helps keep bots out of the square.</p>
     {status.challenge.siteKey ? <TurnstileWidget siteKey={status.challenge.siteKey} action="account_entry" attempt={attempt} onToken={setToken} onError={setCheckError} className="account-entry-widget"/> : <p className="account-error" role="alert">The entry check is temporarily unavailable. Please try again later.</p>}
     {checkError && <><p className="account-error" role="alert">{checkError}</p><button type="button" className="account-secondary" disabled={Boolean(busy)} onClick={() => { setToken(''); setAttempt(value => value + 1); }}>Retry check</button></>}
    </section>}
   </div>}
   {operationError && <p className="account-error account-entry-error" role="alert">{operationError}</p>}
  </div>
  <footer className="account-entry-footer"><div className="account-entry-actions">
   <button type="submit" form={formId} className="account-primary" disabled={Boolean(busy) || !verificationReady || !status?.emailEnabled || !email.trim()}>{busy === 'save' ? 'Joining the square…' : 'Save and join'}</button>
   <button type="button" className="account-secondary" disabled={Boolean(busy) || !verificationReady} onClick={() => void submit('guest')}>{busy === 'guest' ? 'Joining the square…' : 'Not yet'}</button>
  </div><p>Keep playing as a guest, or verify your email later to finish saving.</p></footer>
 </dialog>, document.body);
}
