import { useCallback, useEffect, useRef, useState } from 'react';
import type { Programme } from '../../shared/community';
import { communityError, communityRequest } from './api';

/** Keep only the public live source during reconnect; moderated images still expire. */
export function expireCommunityProgramme(programme: Programme | null, keepLive: boolean): Programme | null {
 if (!keepLive || programme?.mode !== 'live') return null;
 return programme.images.length ? { ...programme, images: [] } : programme;
}

export function useCommunity(enabled = true, backgroundPlayback = false) {
 const [programme, setProgramme] = useState<Programme | null>(null);
 const [error, setError] = useState('');
 const [loading, setLoading] = useState(enabled);
 const [retry, setRetry] = useState(0);
 const [serverTimeMs, setServerTimeMs] = useState(Date.now());
 const clockState = useRef({ lastSuccess: 0, offset: 0, live: false });
 const refresh = useCallback(() => setRetry(value => value + 1), []);
 useEffect(() => {
  if (!enabled) { setProgramme(null); setLoading(false); return; }
  let disposed = false, pending: AbortController | null = null;
  setLoading(true);
  const poll = async () => {
   if ((document.hidden && !(backgroundPlayback && clockState.current.live)) || pending) return;
   const controller = new AbortController(); pending = controller;
   const started = Date.now(), timeout = setTimeout(() => controller.abort(), 10_000);
   try {
    const value = await communityRequest<Programme>('/programme', { signal: controller.signal });
    if (!disposed) { const lastSuccess = Date.now(), offset = value.serverNowMs - (started + lastSuccess) / 2; clockState.current = { lastSuccess, offset, live: value.mode === 'live' }; setProgramme(value); setServerTimeMs(lastSuccess + offset); setError(''); }
   } catch (cause) { if (!disposed) setError(communityError(cause)); }
   finally { clearTimeout(timeout); if (pending === controller) pending = null; if (!disposed) setLoading(false); }
  };
  void poll();
  const timer = setInterval(() => void poll(), 15_000);
  const clock = setInterval(() => {
   const { lastSuccess, offset } = clockState.current;
   setServerTimeMs(Date.now() + offset);
   if (lastSuccess && Date.now() - lastSuccess >= 60_000) { setProgramme(value => expireCommunityProgramme(value, backgroundPlayback)); setError('The programme is out of date. Refresh to reconnect.'); }
  }, 1000);
  const visible = () => { if (!document.hidden) { if (clockState.current.lastSuccess && Date.now() - clockState.current.lastSuccess >= 60_000) setProgramme(value => expireCommunityProgramme(value, backgroundPlayback)); void poll(); } };
  document.addEventListener('visibilitychange', visible);
  return () => { disposed = true; pending?.abort(); clearInterval(timer); clearInterval(clock); document.removeEventListener('visibilitychange', visible); };
 }, [enabled, retry, backgroundPlayback]);
 return { programme, error, loading, refresh, serverTimeMs };
}
