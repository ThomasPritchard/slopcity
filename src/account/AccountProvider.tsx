import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AccountEntryDecision, AccountStatus } from '../../shared/account';
import { accountError, accountRequest, captureAccountLink } from './api';
import { AccountPanel } from './AccountPanel';
import { EntryAccountPanel } from './EntryAccountPanel';
import './account.css';

type AccountContextValue = { status: AccountStatus | null; loading: boolean; error: string; isOpen: boolean; refresh(): Promise<void>; open(): void; offerSave(): Promise<AccountEntryDecision> };
const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children, initialToken }: { children: ReactNode; initialToken?: string | null }) {
 const [status, setStatus] = useState<AccountStatus | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
 const [opened, setOpened] = useState(Boolean(initialToken)), [token, setToken] = useState<string | null>(initialToken ?? null);
 const [entryOffer, setEntryOffer] = useState(false);
 const entryCompletion = useRef<((decision: AccountEntryDecision) => void) | null>(null);
 const request = useRef(0);
 const refresh = useCallback(async () => {
  const current = ++request.current;
  setLoading(true); setError('');
  try { const next = await accountRequest<AccountStatus>(); if (request.current === current) setStatus(next); }
  catch (cause) { if (request.current === current) { setStatus(null); setError(accountError(cause)); } }
  finally { if (request.current === current) setLoading(false); }
 }, []);
 useEffect(() => {
  const receiveLink = () => {
   const captured = captureAccountLink();
   if (captured) {
    entryCompletion.current?.({ continueToTown: false }); entryCompletion.current = null; setEntryOffer(false);
    setToken(captured); setOpened(true); void refresh();
   }
  };
  receiveLink(); void refresh();
  window.addEventListener('hashchange', receiveLink);
  return () => { request.current++; entryCompletion.current?.({ continueToTown: false }); entryCompletion.current = null; window.removeEventListener('hashchange', receiveLink); };
 }, [refresh]);
 const open = useCallback(() => {
  entryCompletion.current?.({ continueToTown: false }); entryCompletion.current = null; setEntryOffer(false);
  setOpened(true); void refresh();
 }, [refresh]);
 const offerSave = useCallback(() => {
  if (entryCompletion.current || opened) return Promise.resolve<AccountEntryDecision>({ continueToTown: false });
  return new Promise<AccountEntryDecision>(resolve => {
   entryCompletion.current = resolve; setEntryOffer(true); setToken(null); setOpened(true); void refresh();
  });
 }, [refresh, opened]);
 const finish = (decision: AccountEntryDecision) => {
  const complete = entryCompletion.current; entryCompletion.current = null;
  setOpened(false); setToken(null); setEntryOffer(false); complete?.(decision);
 };
 return <AccountContext.Provider value={{ status, loading, error, isOpen: opened, refresh, open, offerSave }}>
  {children}
  {opened && (entryOffer ? <EntryAccountPanel status={status} loading={loading} error={error} onRetry={refresh} onClose={() => finish({ continueToTown: false })} onComplete={result => finish({ continueToTown: true, ...(result.message ? { notice: result.message } : {}) })}/>
   : <AccountPanel status={status} loading={loading} error={error} token={token} onRetry={refresh} onClose={() => finish({ continueToTown: false })}/>)}
 </AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
 const context = useContext(AccountContext);
 if (!context) throw new Error('useAccount requires AccountProvider.');
 return context;
}

export { captureAccountLink } from './api';
