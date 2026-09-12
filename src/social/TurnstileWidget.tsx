import { useEffect, useRef } from 'react';

type Turnstile = { render(element: HTMLElement, options: Record<string, unknown>): string; remove(id: string): void; reset(id: string): void };
export type VerificationAction = 'town_entry' | 'account_entry' | 'account_email' | 'community_upload';
declare global { interface Window { turnstile?: Turnstile } }
let script: Promise<Turnstile> | undefined;

function loadWidget(): Promise<Turnstile> {
 if (window.turnstile) return Promise.resolve(window.turnstile);
 if (script) return script;
 script = new Promise((resolve, reject) => {
  const element = document.createElement('script');
  element.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; element.async = true;
  const fail = () => { clearTimeout(timeout); element.remove(); script = undefined; reject(new Error('The check could not load.')); };
  const timeout = window.setTimeout(fail, 15_000);
  element.onerror = fail;
  element.onload = () => { clearTimeout(timeout); if (window.turnstile) resolve(window.turnstile); else fail(); };
  document.head.append(element);
 });
 return script;
}

export function TurnstileWidget({ siteKey, action, attempt = 0, onToken, onError, className = 'entry-check-widget' }: {
 siteKey: string; action: VerificationAction; attempt?: number; onToken(token: string): void; onError(error: string): void; className?: string;
}) {
 const container = useRef<HTMLDivElement>(null);
 const callbacks = useRef({ onToken, onError }); callbacks.current = { onToken, onError };
 useEffect(() => {
  let stopped = false, widget: string | undefined, api: Turnstile | undefined;
  const token = (value: string) => { if (!stopped) callbacks.current.onToken(value); };
  const error = (value: string) => { if (!stopped) callbacks.current.onError(value); };
  token(''); error('');
  void loadWidget().then(value => {
   if (stopped || !container.current) return;
   api = value;
   widget = api.render(container.current, { sitekey: siteKey, action, theme: 'auto', size: 'flexible',
    callback: (value: string) => { token(value); error(''); },
    'expired-callback': () => { token(''); error('The check expired. Please retry.'); },
    'error-callback': () => { token(''); error('The check could not finish. Please retry.'); },
    'timeout-callback': () => { token(''); error('The check timed out. Please retry.'); },
   });
  }).catch(() => error(action === 'town_entry' ? 'The entry check could not load. Check your connection or content blocker, then retry.' : 'The check could not load. Check your connection or content blocker, then retry.'));
  return () => { stopped = true; if (widget !== undefined) api?.remove(widget); };
 }, [siteKey, action, attempt]);
 return <div ref={container} className={className}/>;
}
