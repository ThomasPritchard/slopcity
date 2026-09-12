import { useCallback, useEffect, useRef, useState } from 'react';
import type { VerificationConfig } from '../../shared/account';
import { EntryCheck } from '../social/useAdmission';

type PendingCheck = { siteKey: string; resolve(token: string): void; reject(error: Error): void };

export function useVerification(action: 'account_email' | 'community_upload', config: VerificationConfig) {
 const [pending, setPending] = useState<PendingCheck | null>(null);
 const active = useRef<PendingCheck | null>(null);
 useEffect(() => () => { active.current?.reject(new Error('Verification closed. Please try again.')); active.current = null; }, []);
 const requestToken = useCallback(async () => {
  if (!config.enabled) return undefined;
  if (!config.siteKey) throw new Error('Verification is temporarily unavailable. Please try again later.');
  if (active.current) throw new Error('Finish the open verification check first.');
  return new Promise<string>((resolve, reject) => {
   const close = () => { active.current = null; setPending(null); };
   const value = { siteKey: config.siteKey, resolve: (token: string) => { close(); resolve(token); }, reject: (error: Error) => { close(); reject(error); } };
   active.current = value; setPending(value);
  });
 }, [config.enabled, config.siteKey]);
 return {
  requestToken,
  dialog: pending ? <EntryCheck {...pending} action={action} title={action === 'account_email' ? 'A quick check before we send.' : 'A quick check before you share.'}
   prompt={action === 'account_email' ? 'This helps prevent unwanted emails. Complete this check to request your sign-in link.' : 'This helps keep the review queue free of spam. Complete a fresh check for each image you send.'}/> : null,
 };
}
