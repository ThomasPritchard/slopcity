import { useEffect, useState } from 'react';
import { CREDIT_LEADERBOARD_REFRESH_MS, type CreditLeaderboard } from '../../shared/creditLeaderboard';

export function useCreditLeaderboard(enabled: boolean) {
 const [snapshot, setSnapshot] = useState<CreditLeaderboard | null>(null);
 const [unavailable, setUnavailable] = useState(false);
 useEffect(() => {
  if (!enabled) { setSnapshot(null); setUnavailable(false); return; }
  let pending: AbortController | null = null, disposed = false;
  const refresh = async () => {
   if (document.hidden || pending) return;
   const controller = new AbortController(); pending = controller;
   const timeout = setTimeout(() => controller.abort(), 10_000);
   try {
    const response = await fetch('/game/api/economy/leaderboard', { signal: controller.signal });
    if (!response.ok) throw new Error('Leaderboard unavailable');
    const value = await response.json() as CreditLeaderboard;
    if (!disposed) { setSnapshot(value); setUnavailable(false); }
   } catch { if (!disposed) setUnavailable(true); }
   finally { clearTimeout(timeout); if (pending === controller) pending = null; }
  };
  void refresh();
  const timer = setInterval(() => void refresh(), CREDIT_LEADERBOARD_REFRESH_MS);
  const visible = () => { if (!document.hidden) void refresh(); };
  document.addEventListener('visibilitychange', visible);
  return () => { disposed = true; clearInterval(timer); pending?.abort(); document.removeEventListener('visibilitychange', visible); };
 }, [enabled]);
 return { snapshot, unavailable };
}
