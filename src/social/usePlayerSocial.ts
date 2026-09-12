import { useCallback, useEffect, useRef, useState } from 'react';
import type { FriendAction, SocialSnapshot } from '../../shared/playerSocial';
import type { WalletState } from '../../shared/catalog';
import { changeFriend, getSocial, giveCredits, SocialError } from './api';

export type PendingGift = { ownerId: string; targetId: string; targetName: string; amount: number; requestId: string };
const storageKey = (id: string) => `slop-city-pending-gift:${id}`;
export function usePlayerSocial(enabled: boolean, ownerId: string | undefined, onWallet: (state: WalletState) => void) {
  const [snapshot, setSnapshot] = useState<SocialSnapshot | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingGift | null>(null);
  const context = useRef({ enabled, ownerId }); context.current = { enabled, ownerId };
  const version = useRef(0), changing = useRef(false), pendingRef = useRef<PendingGift | null>(null);
  const refresh = useCallback(async () => {
    const owner = context.current.ownerId;
    if (!owner || !context.current.enabled) return;
    const current = ++version.current;
    try { const value = await getSocial(); if (current === version.current && context.current.ownerId === owner && context.current.enabled) { setSnapshot(value); setError(''); } }
    catch { if (current === version.current && context.current.enabled) setError('Your social details could not load. Try again.'); }
  }, []);
  useEffect(() => {
    pendingRef.current = null; setPending(null); setSnapshot(null); version.current++;
    if (!ownerId) return;
    try {
      const value = JSON.parse(localStorage.getItem(storageKey(ownerId)) || 'null') as PendingGift | null;
      if (value?.ownerId === ownerId && typeof value.targetId === 'string' && typeof value.targetName === 'string' && typeof value.requestId === 'string' && Number.isSafeInteger(value.amount) && value.amount > 0 && value.amount <= 1000) { pendingRef.current = value; setPending(value); }
    } catch { /* The outstanding request remains safe to retry during this session. */ }
  }, [ownerId]);
  useEffect(() => {
    if (!enabled) { version.current++; return; }
    void refresh(); const timer = setInterval(() => { if (!document.hidden && !changing.current) void refresh(); }, 5000);
    return () => { clearInterval(timer); version.current++; };
  }, [enabled, ownerId, refresh]);
  async function friend(targetId: string, action: FriendAction) {
    if (changing.current || !context.current.enabled) return;
    changing.current = true; setBusy(true); setError(''); setNotice(''); version.current++;
    const owner = ownerId;
    try {
      const value = await changeFriend(targetId, action);
      if (context.current.ownerId === owner && context.current.enabled) { version.current++; setSnapshot(value); setNotice(action === 'request' ? 'Friend request sent.' : action === 'accept' ? 'You are now friends.' : action === 'remove' ? 'Friend removed.' : 'Request cleared.'); }
    } catch (error) { if (context.current.ownerId === owner) setError(error instanceof Error ? error.message : 'That change could not be saved.'); }
    finally { changing.current = false; setBusy(false); }
  }
  function remember(value: PendingGift | null, owner: string) {
    pendingRef.current = value; setPending(value);
    try { if (value) localStorage.setItem(storageKey(owner), JSON.stringify(value)); else localStorage.removeItem(storageKey(owner)); } catch { /* Server request IDs still protect retries in this page. */ }
  }
  async function gift(targetId: string, targetName: string, amount: number) {
    if (changing.current || !ownerId || !context.current.enabled) return false;
    const previous = pendingRef.current;
    if (previous && (previous.targetId !== targetId || previous.amount !== amount)) { setError('Check the pending gift before sending another.'); return false; }
    const command = previous ?? { ownerId, targetId, targetName, amount, requestId: crypto.randomUUID() };
    remember(command, ownerId); changing.current = true; setBusy(true); setError(''); setNotice(''); version.current++;
    try {
      const receipt = await giveCredits(command.targetId, command.amount, command.requestId);
      if (context.current.ownerId === ownerId) {
        remember(null, ownerId); onWallet(receipt.wallet);
        setSnapshot(value => value ? { ...value, giftingAllowance: receipt.giftingAllowance } : null);
        setNotice(receipt.reversed ? 'This gift was removed after coordinated gift activity was detected.' : `${receipt.amount.toLocaleString()} credits sent to ${targetName}.`); void refresh();
      }
      return true;
    } catch (error) {
      if (context.current.ownerId === ownerId) {
        const definitive = error instanceof SocialError && error.status >= 400 && error.status < 500;
        if (definitive && error.status !== 429) remember(null, ownerId);
        setError(definitive ? error.message : 'Confirmation is delayed. Check the same gift again; it will only be sent once.');
      }
      return false;
    } finally { changing.current = false; setBusy(false); }
  }
  return { snapshot, error, notice, busy, pending, refresh, friend, gift, clearFeedback: () => { setError(''); setNotice(''); } };
}
