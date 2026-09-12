import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AdmissionStatus } from '../../shared/admission';
import { TurnstileWidget } from './TurnstileWidget';
import './admission.css';

async function status(): Promise<AdmissionStatus> {
 const response = await fetch('/game/api/admission',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15_000)});
 const body = await response.json();
 if (!response.ok) throw new Error(body.error || 'The entry check is unavailable. Please retry.');
 return body;
}
export function EntryCheck({siteKey,resolve,reject,action='town_entry',title='A quick check before you join.',prompt='This helps keep bots out of the square. If the host requested a fresh check, complete it within two minutes to stay connected.'}: {siteKey:string;resolve(token:string):void;reject(error:Error):void;action?:'town_entry'|'account_email'|'community_upload';title?:string;prompt?:string}) {
 const dialog = useRef<HTMLDialogElement>(null);
 const headingId = useId();
 const [error,setError] = useState(''), [attempt,setAttempt] = useState(0), [token,setToken] = useState('');
 const cancelled = () => new Error(action === 'town_entry' ? 'Entry check cancelled.' : 'Verification cancelled. You can try again when you are ready.');
 useEffect(() => {
  const node = dialog.current!, previous = document.activeElement;
  node.showModal();
  return () => { node.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({preventScroll:true}); };
 },[]);
 return createPortal(<dialog ref={dialog} className="entry-check" aria-labelledby={action === 'town_entry' ? 'entry-check-title' : headingId} onKeyDown={event=>event.stopPropagation()} onCancel={event=>{event.preventDefault();event.stopPropagation();reject(cancelled());}}>
  <span className="eyebrow">SLOP CITY</span><h2 id={action === 'town_entry' ? 'entry-check-title' : headingId}>{title}</h2>
  <p>{prompt}</p>
  <TurnstileWidget siteKey={siteKey} action={action} attempt={attempt} onToken={setToken} onError={setError}/>
  {error && <p role="alert">{error}</p>}
  <div className="entry-check-actions">
   {error && <button type="button" onClick={()=>setAttempt(value=>value+1)}>Retry check</button>}
   <button type="button" disabled={!token} onClick={()=>resolve(token)}>Continue</button>
   <button type="button" className="secondary" onClick={()=>reject(cancelled())}>Cancel</button>
  </div>
 </dialog>,document.body);
}

export function useAdmission() {
 const [pending,setPending] = useState<{siteKey:string;resolve(token:string):void;reject(error:Error):void}|null>(null);
 const active = useRef<typeof pending>(null);
 useEffect(()=>()=>{active.current?.reject(new Error('Entry check closed.'));active.current=null;},[]);
 const requestToken = useCallback(async (joining = false, force = false) => {
  const config = await status();
  if (!force && config.mode === 'paused') throw new Error('Town entry is temporarily paused. Please try again shortly.');
  if (!config.enabled || (joining && config.verified && !force)) return undefined;
  if (active.current) throw new Error('An entry check is already open.');
  return new Promise<string>((resolve,reject)=>{
   const close = () => { active.current = null; setPending(null); };
   const value = {siteKey:config.siteKey,resolve:(token:string)=>{close();resolve(token);},reject:(error:Error)=>{close();reject(error);}};
   active.current=value;setPending(value);
  });
 },[]);
 const ensure = useCallback(async (force = false) => {
  const token = await requestToken(true,force);
  if (!token) return;
  const response = await fetch('/game/api/admission',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({turnstileToken:token}),signal:AbortSignal.timeout(15_000)});
  if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'Please retry the entry check.'); }
 },[requestToken]);
 return { requestToken, ensure, dialog: pending ? <EntryCheck {...pending}/> : null };
}
