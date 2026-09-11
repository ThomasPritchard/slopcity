import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AdmissionStatus } from '../../shared/admission';
import './admission.css';

type Turnstile = { render(element: HTMLElement, options: Record<string, unknown>): string; remove(id: string): void; reset(id: string): void };
declare global { interface Window { turnstile?: Turnstile } }
let script: Promise<Turnstile> | undefined;
function loadWidget(): Promise<Turnstile> {
 if (window.turnstile) return Promise.resolve(window.turnstile);
 if (script) return script;
 script = new Promise((resolve,reject) => {
  const element = document.createElement('script');
  element.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; element.async = true;
  const fail = () => { clearTimeout(timeout); element.remove(); script = undefined; reject(new Error('The entry check could not load. Check your connection or content blocker, then retry.')); };
  const timeout = window.setTimeout(fail,15_000);
  element.onerror = fail;
  element.onload = () => { clearTimeout(timeout); if (window.turnstile) resolve(window.turnstile); else fail(); };
  document.head.append(element);
 });
 return script;
}
async function status(): Promise<AdmissionStatus> {
 const response = await fetch('/game/api/admission',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15_000)});
 const body = await response.json();
 if (!response.ok) throw new Error(body.error || 'The entry check is unavailable. Please retry.');
 return body;
}
function EntryCheck({siteKey,resolve,reject}: {siteKey:string;resolve(token:string):void;reject(error:Error):void}) {
 const dialog = useRef<HTMLDialogElement>(null), container = useRef<HTMLDivElement>(null);
 const [error,setError] = useState(''), [attempt,setAttempt] = useState(0), [token,setToken] = useState('');
 useEffect(() => { dialog.current?.showModal(); },[]);
 useEffect(() => {
  let stopped = false, widget: string | undefined, api: Turnstile | undefined;
  setError(''); setToken('');
  void loadWidget().then(value => {
   if (stopped || !container.current) return;
   api = value;
   widget = api.render(container.current, {sitekey:siteKey,action:'town_entry',theme:'auto',size:'flexible',
    callback:(value:string)=>{if(!stopped){setToken(value);setError('');}},
    'expired-callback':()=>{if(!stopped){setToken('');setError('The check expired. Please retry.');}},
    'error-callback':()=>{if(!stopped){setToken('');setError('The check could not finish. Please retry.');}},
    'timeout-callback':()=>{if(!stopped){setToken('');setError('The check timed out. Please retry.');}},
   });
  }).catch(cause=>{if(!stopped)setError(cause.message);});
  return () => { stopped = true; if (widget !== undefined) api?.remove(widget); };
 },[siteKey,attempt]);
 return createPortal(<dialog ref={dialog} className="entry-check" aria-labelledby="entry-check-title" onCancel={event=>{event.preventDefault();reject(new Error('Entry check cancelled.'));}}>
  <span className="eyebrow">SLOP CITY</span><h2 id="entry-check-title">A quick check before you join.</h2>
  <p>This helps keep bots out of the square. If the host requested a fresh check, complete it within two minutes to stay connected.</p>
  <div ref={container} className="entry-check-widget"/>
  {error && <p role="alert">{error}</p>}
  <div className="entry-check-actions">
   {error && <button type="button" onClick={()=>setAttempt(value=>value+1)}>Retry check</button>}
   <button type="button" disabled={!token} onClick={()=>resolve(token)}>Continue</button>
   <button type="button" className="secondary" onClick={()=>reject(new Error('Entry check cancelled.'))}>Cancel</button>
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
