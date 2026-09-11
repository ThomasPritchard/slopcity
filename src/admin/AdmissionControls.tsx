import { useCallback, useEffect, useState } from 'react';
import type { AdmissionAdmin, AdmissionMode } from '../../shared/admission';
import { CommunityApiError, communityRequest } from '../community/api';
export function AdmissionControls({onSessionExpired}: {onSessionExpired():void}) {
 const [state,setState] = useState<AdmissionAdmin|null>(null), [mode,setMode] = useState<AdmissionMode>('open');
 const [guestId,setGuestId] = useState(''), [error,setError] = useState(''), [notice,setNotice] = useState(''), [busy,setBusy] = useState(false), [confirm,setConfirm] = useState(false);
 const failure = useCallback((cause:unknown)=>{if(cause instanceof CommunityApiError && cause.status===401){setState(null);onSessionExpired();}else setError(cause instanceof Error?cause.message:'Entry controls are unavailable.');},[onSessionExpired]);
 useEffect(()=>{
  const controller=new AbortController();
  void communityRequest<AdmissionAdmin>('/admin/admission',{signal:controller.signal}).then(value=>{setState(value);setMode(value.mode);}).catch(cause=>{if(!controller.signal.aborted)failure(cause);});
  return ()=>controller.abort();
 },[failure]);
 async function change(action:string,target:string) {
  if(busy)return;setBusy(true);setError('');setNotice('');
  try {
   const value=await communityRequest<AdmissionAdmin>('/admin/admission',{method:'POST',body:JSON.stringify({action,target}),signal:AbortSignal.timeout(15_000)});
   setState(value);setMode(value.mode);setConfirm(false);
   setNotice(action==='reverify'?'Connected players have two minutes to complete a fresh check.':action==='mode'?'Entry mode saved. Players already in town can stay.':action==='approve'?'Guest approved. Their entry check is still required.':'Guest approval removed. This affects their next entry.');
   if(action==='approve')setGuestId('');
  }catch(cause){failure(cause);}finally{setBusy(false);}
 }
 return <section className="town-safety-section" aria-labelledby="raid-controls-title">
  <h3 id="raid-controls-title">Entry & raid controls</h3>
  <p>Turnstile checks new and returning guests. Pausing entry or restricting it to approved guests does not remove players already in town.</p>
  {error && <p className="community-error" role="alert">{error}</p>}
  {notice && <p className="community-notice" role="status">{notice}</p>}
  {state && <>
   <p>Entry checks: <strong>{state.enabled?'Enabled':'Not configured'}</strong> · Current mode: <strong>{state.mode==='open'?'Open':state.mode==='paused'?'Paused':'Approved guests only'}</strong></p>
   <form className="community-form" onSubmit={event=>{event.preventDefault();void change('mode',mode);}}>
    <label>Town entry<select aria-label="Town entry" value={mode} onChange={event=>setMode(event.target.value as AdmissionMode)} disabled={busy}><option value="open">Open — entry check required</option><option value="paused">Paused — nobody new can enter</option><option value="approved">Approved guests only — entry check required</option></select></label>
    <button className="community-button" disabled={busy || mode===state.mode}>Save entry mode</button>
   </form>
   <div className="town-safety-actions">
    {!confirm ? <button className="community-secondary" disabled={busy||!state.enabled} onClick={()=>setConfirm(true)}>Request fresh checks</button> : <div><p>Ask every connected player to verify again? Anyone who does not finish within two minutes will be disconnected and can rejoin after verification.</p><button className="community-button" disabled={busy} onClick={()=>void change('reverify','all')}>Confirm fresh checks</button> <button className="community-secondary" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button></div>}
   </div>
   <form className="community-form" onSubmit={event=>{event.preventDefault();void change('approve',guestId.trim());}}>
    <label>Approve a guest ID<input value={guestId} onChange={event=>setGuestId(event.target.value)} required maxLength={36} spellCheck={false} autoComplete="off" placeholder="Copy the ID from the guest search below"/></label>
    <button className="community-secondary" disabled={busy||!guestId.trim()}>Approve guest</button>
   </form>
   {state.approved.length>0 && <ul className="town-safety-list">{state.approved.map(guest=><li key={guest.id}><div className="town-safety-identity"><strong>{guest.name}</strong><code>{guest.id}</code></div><button className="community-secondary" disabled={busy} onClick={()=>void change('revoke',guest.id)}>Remove approval</button></li>)}</ul>}
  </>}
 </section>;
}
