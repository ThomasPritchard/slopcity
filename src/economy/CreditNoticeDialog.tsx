import { useEffect, useRef, useState } from 'react';
import { creditActivityDates, type CreditNotice } from '../../shared/creditProtection';
import './credit-notice.css';

export function CreditNoticeDialog({ onOpenChange }: { onOpenChange(open: boolean): void }) {
 const dialog = useRef<HTMLDialogElement>(null);
 const [notices,setNotices] = useState<CreditNotice[]>([]);
 const [error,setError] = useState(''), [busy,setBusy] = useState(false);
 const [retry,setRetry] = useState(0);
 const callback = useRef(onOpenChange); callback.current=onOpenChange;
 const mounted=useRef(true);
 useEffect(() => {
  mounted.current=true;
  return () => {mounted.current=false;callback.current(false);};
 },[]);
 // Mounted only after a world connection. Acknowledged notices stay in the database;
 // a refresh, another browser or a lost acknowledgement cannot deduct credits again.
 useEffect(() => {
  const controller = new AbortController();
  void fetch('/game/api/economy/notices',{credentials:'same-origin',signal:controller.signal})
   .then(async response => {if(!response.ok)throw new Error();return response.json();})
   .then(value => {if(!controller.signal.aborted){setNotices(value.notices);setError('');}})
   .catch(() => {if(!controller.signal.aborted)setError('Your credit notices could not load. Please retry.');});
  return () => controller.abort();
 },[retry]);
 useEffect(() => {
  const open=notices.length>0;
  callback.current(open);
  if(open&&!dialog.current?.open)dialog.current?.showModal();
  return () => {dialog.current?.close();};
 },[notices]);
 async function acknowledge() {
  if(busy)return;
  setBusy(true);setError('');
  try {
   for(let start=0;start<notices.length;start+=20){
    const response=await fetch('/game/api/economy/notices/acknowledge',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({notices:notices.slice(start,start+20).map(({id,revision})=>({id,revision}))})});
    if(!response.ok){if(response.status===409)setRetry(v=>v+1);throw new Error('Your acknowledgement could not be saved. Please try again.');}
   }
   if(mounted.current)setNotices([]);
  } catch(e) {if(mounted.current)setError(e instanceof Error?e.message:'Please try again.');}
  finally {if(mounted.current)setBusy(false);}
 }
 if(!notices.length)return error?<div className="credit-notice-retry" role="status">{error}<button onClick={()=>setRetry(v=>v+1)}>Retry credit notices</button></div>:null;
 const total=notices.reduce((sum,n)=>sum+n.credits,0), reset=[...notices].reverse().find(n=>n.balanceResetTo!==null);
 const activity=creditActivityDates(Math.min(...notices.map(n=>n.activityStartedAt)),Math.max(...notices.map(n=>n.activityEndedAt)));
 return <dialog ref={dialog} className="credit-notice" aria-labelledby="credit-notice-title" aria-describedby="credit-notice-explanation" onCancel={event=>event.preventDefault()} onKeyDown={event=>event.stopPropagation()}>
  <div className="credit-notice-heading"><span className="credit-notice-eyebrow">SLOP CITY · FAIR PLAY</span><h2 id="credit-notice-title" tabIndex={-1} autoFocus>Suspicious gift activity</h2><p className="credit-notice-date">Activity on <strong>{activity}</strong></p>{reset&&<p className="credit-notice-reset">Your credits have been reset to the starting amount of <strong>{reset.balanceResetTo!.toLocaleString('en-GB')} credits</strong>.</p>}</div>
  <div className="credit-notice-body">
   <p id="credit-notice-explanation">A coordinated pattern of newly created profiles collecting salary and sending gifts to your wallet was detected. {reset?'Removing the affected gifts would have taken your balance below zero, so it was reset instead. You have nothing left to repay.':'The affected gift credits have been removed.'}</p>
   <dl className="credit-notice-amount"><div><dt>{reset?'Gift credits involved':'Credits removed'}</dt><dd>{total.toLocaleString('en-GB')}</dd></div></dl>
   {notices.length>1&&<ul className="credit-notice-activity">{notices.map(n=><li key={n.id}><span>Activity on <strong>{creditActivityDates(n.activityStartedAt,n.activityEndedAt)}</strong></span><span>{n.credits.toLocaleString('en-GB')} gift credits{n.balanceResetTo!==null?` · Reset to ${n.balanceResetTo.toLocaleString('en-GB')}`:' · Removed'}</span></li>)}</ul>}
   <p className="credit-notice-warning">Gifting from the identified farming profiles is blocked. Please do not use additional profiles to farm salary or funnel credits.</p>
   {error&&<p role="alert" className="credit-notice-error">{error}</p>}
  </div>
  <div className="credit-notice-footer"><button type="button" onClick={()=>void acknowledge()} disabled={busy}>{busy?'Saving…':'I understand'}</button></div>
 </dialog>;
}
