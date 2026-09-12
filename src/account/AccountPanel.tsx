import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AccountLink, AccountStatus } from '../../shared/account';
import { accountError, accountRequest } from './api';
import { useVerification } from './useVerification';

type Props = { status: AccountStatus | null; loading: boolean; error: string; token: string | null; onRetry(): Promise<void>; onClose(): void };

export function AccountPanel({ status, loading, error, token, onRetry, onClose }: Props) {
 const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
 const titleId = useId(), emailId = useId(), helpId = useId();
 const [email, setEmail] = useState(''), [mode, setMode] = useState<'upgrade' | 'signin' | null>(null);
 const [busy, setBusy] = useState(false), [operationError, setOperationError] = useState(''), [sent, setSent] = useState(false);
 const [link, setLink] = useState<AccountLink | null>(null), [inspecting, setInspecting] = useState(Boolean(token));
 const [inspectError, setInspectError] = useState(''), [inspectAttempt, setInspectAttempt] = useState(0), [confirmSwitch, setConfirmSwitch] = useState(false);
 const verification = useVerification('account_email', status?.challenge ?? { enabled: true, siteKey: '' });
 const purpose = status?.kind === 'guest' && mode !== 'signin' ? 'upgrade' : 'signin';

 useEffect(() => {
  const node = dialog.current!, previous = document.activeElement;
  node.showModal(); heading.current?.focus({ preventScroll: true });
  return () => { node.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); else document.getElementById('world')?.focus({ preventScroll: true }); };
 }, []);
 useEffect(() => { if (sent || operationError) heading.current?.focus({ preventScroll: true }); }, [sent, operationError]);
 useEffect(() => {
  if (!token) return;
  let active = true;
  setInspecting(true); setInspectError(''); setLink(null); setConfirmSwitch(false); setOperationError('');
  void accountRequest<AccountLink>('/inspect', { method: 'POST', body: JSON.stringify({ token }) })
   .then(value => { if (active) setLink(value); })
   .catch(cause => { if (active) setInspectError(accountError(cause)); })
   .finally(() => { if (active) setInspecting(false); });
  return () => { active = false; };
 }, [token, inspectAttempt]);

 async function sendEmail(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (busy || !status?.emailEnabled || loading) return;
  setBusy(true); setOperationError('');
  try {
   const turnstileToken = await verification.requestToken();
   await accountRequest(`/${purpose}`, { method: 'POST', body: JSON.stringify({ email: email.trim(), turnstileToken }) });
   setSent(true);
  } catch (cause) { setOperationError(accountError(cause)); }
  finally { setBusy(false); }
 }
 async function confirm() {
  if (busy || !token || !link || (link.requiresProfileSwitch && !confirmSwitch)) return;
  setBusy(true); setOperationError('');
  try {
   await accountRequest('/confirm', { method: 'POST', body: JSON.stringify({ token, expectedCurrentProfileId: link.currentProfileId, confirmProfileSwitch: link.requiresProfileSwitch && confirmSwitch }) });
   window.location.replace('/');
  } catch (cause) { setOperationError(accountError(cause)); setBusy(false); }
 }
 async function signOut() {
  if (busy) return;
  setBusy(true); setOperationError('');
  try { await accountRequest('/logout', { method: 'POST' }); window.location.replace('/'); }
  catch (cause) { setOperationError(accountError(cause)); setBusy(false); }
 }
 const title = token ? (link?.purpose === 'upgrade' ? 'Save your progress.' : 'Open your account.')
  : sent ? 'Check your email.' : status?.kind === 'member' ? 'Your place in town.' : purpose === 'upgrade' ? 'Save your progress.' : 'Welcome back.';

 return createPortal(<>
  <dialog ref={dialog} className="account-dialog" aria-labelledby={titleId}
   onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}>
   <header className="account-header"><div><span className="account-kicker">YOUR SLOP CITY ACCOUNT</span><h2 id={titleId} ref={heading} tabIndex={-1}>{title}</h2></div>
    <button type="button" className="account-close" aria-label="Close account" disabled={busy} onClick={onClose}>×</button>
   </header>
   <div className="account-content">
    {token ? <>
     {inspecting && <p role="status">Checking your link…</p>}
     {inspectError && <><p className="account-error" role="alert">{inspectError}</p><button type="button" className="account-secondary" onClick={() => setInspectAttempt(value => value + 1)}>Check link again</button><p className="account-note">If this link has expired or has already been used, close this window and request a new one.</p></>}
     {link && <>
      <p>{link.purpose === 'upgrade' ? <>Save <strong>{link.profileName}</strong> with this email address. Your credits, clothing and friends will stay with you.</> : <>Sign in as <strong>{link.profileName}</strong> with this email address.</>}</p>
      <p className="account-email">{link.email}</p>
      {link.requiresProfileSwitch && <div className="account-switch-warning">
       <h3>You are switching profiles.</h3><p>Your current profile’s credits, clothing and friends will not be merged into this account. {status?.kind === 'member' ? 'You can sign back in to your current account with its email address.' : 'An unsaved guest profile will no longer be accessible from this browser.'}</p>
       <label className="account-checkbox"><input type="checkbox" checked={confirmSwitch} disabled={busy} onChange={event => setConfirmSwitch(event.target.checked)}/><span>I understand and want to switch profiles.</span></label>
      </div>}
      <p className="account-note">Signing in here signs this account out on other devices.</p>
      {operationError && <p className="account-error" role="alert">{operationError}</p>}
      <button type="button" className="account-primary" disabled={busy || (link.requiresProfileSwitch && !confirmSwitch)} onClick={() => void confirm()}>
       {busy ? 'Opening your account…' : link.purpose === 'upgrade' ? 'Confirm and save my progress' : link.requiresProfileSwitch ? 'Confirm and switch profiles' : 'Confirm and sign in'}
      </button>
     </>}
    </> : loading ? <p role="status">Loading your account…</p> : error || !status ? <><p className="account-error" role="alert">{error || 'Your account could not be reached. Please try again.'}</p><button type="button" className="account-secondary" onClick={() => void onRetry()}>Try again</button></> : status.kind === 'member' ? <>
     <p>Your progress is saved to your email account. You can use it to sign in on another device and send images for review.</p>
     <span className="account-field-label">Verified email</span><p className="account-email">{status.email}</p>
     <p className="account-note">Signing in on another device signs this account out here. Your progress stays saved when you sign out.</p>
     {operationError && <p className="account-error" role="alert">{operationError}</p>}
     <button type="button" className="account-secondary" disabled={busy} onClick={() => void signOut()}>{busy ? 'Signing out…' : 'Sign out'}</button>
    </> : sent ? <>
     <p role="status">If this email can be used, a link will arrive shortly. Check your inbox and spam folder.</p>
     {purpose === 'upgrade' && <p>Open the link in this browser to save your guest’s progress.</p>}
     <p className="account-note">The email link takes you back here for confirmation. It can only be used once.</p>
     <button type="button" className="account-secondary" onClick={() => { setSent(false); setOperationError(''); }}>Use another email or try again</button>
    </> : <>
     <p>{purpose === 'upgrade' ? 'Keep your credits, clothing and friends, and share images with the town. Add an email address to save the guest you are playing as.' : 'Enter your email and we’ll send you a sign-in link. You won’t need a password.'}</p>
     {purpose === 'upgrade' && <p className="account-note">You can keep playing as a guest. Image submissions need a verified email account.</p>}
     {!status.emailEnabled ? <p className="account-notice" role="status">Email sign-in is not available yet. {status.kind === 'guest' ? 'Your guest progress remains saved in this browser.' : 'You can still join the town as a guest.'} Please try again once the town’s email service is ready.</p> : <form className="account-form" onSubmit={event => void sendEmail(event)} aria-label={purpose === 'upgrade' ? 'Save your guest account' : 'Sign in to your account'}>
      <label htmlFor={emailId}>Email address</label><input id={emailId} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} aria-describedby={helpId} placeholder="you@example.com"/>
      <p className="account-note" id={helpId}>{purpose === 'upgrade' ? 'We’ll email a link to confirm this address. Your email stays private.' : 'Signing in signs this account out on other devices. Your email stays private.'}</p>
      {operationError && <p className="account-error" role="alert">{operationError}</p>}
      <button type="submit" className="account-primary" disabled={busy || !email.trim()}>{busy ? 'Preparing your email…' : purpose === 'upgrade' ? 'Email me a verification link' : 'Email me a sign-in link'}</button>
     </form>}
     {status.kind === 'guest' && <div className="account-alternative"><button type="button" className="account-text-button" disabled={busy} onClick={() => { setMode(purpose === 'upgrade' ? 'signin' : 'upgrade'); setOperationError(''); }}>{purpose === 'upgrade' ? 'Already have an account? Sign in' : 'Save this guest’s progress instead'}</button></div>}
    </>}
   </div>
  </dialog>
  {verification.dialog}
 </>, document.body);
}
