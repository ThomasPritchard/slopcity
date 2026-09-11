import { useCallback, useEffect, useRef, useState } from 'react';
import type { Programme } from '../../shared/community';
import { communityError, communityRequest } from './api';

export function useCommunity(enabled = true) {
 const [programme, setProgramme] = useState<Programme | null>(null);
 const [error, setError] = useState('');
 const [loading, setLoading] = useState(enabled);
 const [retry, setRetry] = useState(0);
 const [serverTimeMs, setServerTimeMs] = useState(Date.now());
 const clockState = useRef({ lastSuccess: 0, offset: 0 });
 const refresh = useCallback(() => setRetry(value => value + 1), []);
 useEffect(() => {
  if (!enabled) { setProgramme(null); setLoading(false); return; }
  let disposed = false, pending: AbortController | null = null;
  setLoading(true);
  const poll = async () => {
   if (document.hidden || pending) return;
   const controller = new AbortController(); pending = controller;
   const started = Date.now(), timeout = setTimeout(() => controller.abort(), 10_000);
   try {
    const value = await communityRequest<Programme>('/programme', { signal: controller.signal });
    if (!disposed) { const lastSuccess = Date.now(), offset = value.serverNowMs - (started + lastSuccess) / 2; clockState.current = { lastSuccess, offset }; setProgramme(value); setServerTimeMs(lastSuccess + offset); setError(''); }
   } catch (cause) { if (!disposed) setError(communityError(cause)); }
   finally { clearTimeout(timeout); if (pending === controller) pending = null; if (!disposed) setLoading(false); }
  };
  void poll();
  const timer = setInterval(() => void poll(), 15_000);
  const clock = setInterval(() => {
   const { lastSuccess, offset } = clockState.current;
   setServerTimeMs(Date.now() + offset);
   if (lastSuccess && Date.now() - lastSuccess >= 60_000) { setProgramme(null); setError('The programme is out of date. Refresh to reconnect.'); }
  }, 1000);
  const visible = () => { if (!document.hidden) { if (clockState.current.lastSuccess && Date.now() - clockState.current.lastSuccess >= 60_000) setProgramme(null); void poll(); } };
  document.addEventListener('visibilitychange', visible);
  return () => { disposed = true; pending?.abort(); clearInterval(timer); clearInterval(clock); document.removeEventListener('visibilitychange', visible); };
 }, [enabled, retry]);
 return { programme, error, loading, refresh, serverTimeMs };
}
