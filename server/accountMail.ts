import { chmod, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export type AccountMailConfig = { mode: 'disabled' | 'outbox' | 'resend'; origin: string; apiKey?: string; from?: string; outboxDir?: string };
export function accountMailConfig(env: NodeJS.ProcessEnv = process.env): AccountMailConfig {
 const origin = env.APP_ORIGIN || 'http://localhost:5173';
 let url: URL;
 try { url = new URL(origin); } catch { throw new Error('ACCOUNT_EMAIL requires a valid APP_ORIGIN'); }
 if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('ACCOUNT_EMAIL requires an exact HTTP(S) APP_ORIGIN');
 const local = env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
 const mode = env.ACCOUNT_EMAIL_MODE || (local ? 'outbox' : 'disabled');
 if (mode !== 'disabled' && mode !== 'outbox' && mode !== 'resend') throw new Error('ACCOUNT_EMAIL_MODE must be disabled, outbox or resend');
 if (mode === 'outbox' && !local) throw new Error('Account email outbox requires non-production loopback development');
 if (mode === 'resend' && (!env.RESEND_API_KEY?.trim() || !env.ACCOUNT_EMAIL_FROM?.trim() || /[\r\n]/.test(env.ACCOUNT_EMAIL_FROM))) throw new Error('Resend requires RESEND_API_KEY and ACCOUNT_EMAIL_FROM');
 if (mode === 'resend' && env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Production account email requires HTTPS');
 return { mode, origin, ...(mode === 'resend' ? { apiKey: env.RESEND_API_KEY!.trim(), from: env.ACCOUNT_EMAIL_FROM!.trim() } : {}) };
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export type AccountMail = { token: string; challengeId: string; email: string; purpose: 'upgrade' | 'signin'; profileName: string };
export class AccountMailer {
 readonly enabled: boolean;
 private pendingOutbox: Promise<void> = Promise.resolve();
 constructor(readonly config: AccountMailConfig = accountMailConfig(), private readonly request: typeof fetch = fetch) { this.enabled = config.mode !== 'disabled'; }
 async send(message: AccountMail): Promise<void> {
  if (!this.enabled) throw new Error('Account email is unavailable');
  if (!/^[A-Za-z0-9_-]{43}$/.test(message.token) || !/^[0-9a-f-]{36}$/i.test(message.challengeId) || /[\r\n]/.test(message.email)) throw new Error('Invalid account email request');
  const link = `${this.config.origin}/#account=${message.token}`;
  const subject = message.purpose === 'upgrade' ? 'Save your Slop City profile' : 'Sign in to Slop City';
  const instruction = message.purpose === 'upgrade'
   ? 'Open this link in the same browser where you started saving your guest profile. You must confirm before your email is attached.'
   : 'You must confirm sign-in. If you are playing on another profile, you will be asked to confirm switching; progress is not merged.';
  const text = `${subject}\n\nProfile: ${message.profileName}\n\n${instruction}\n\n${link}\n\nThis link expires in 15 minutes and can be used once. If you did not request it, ignore this email.`;
  const html = `<h1>${subject}</h1><p>Profile: ${escapeHtml(message.profileName)}</p><p>${instruction}</p><p><a href="${escapeHtml(link)}">Continue to Slop City</a></p><p>This link expires in 15 minutes and can be used once. If you did not request it, ignore this email.</p>`;
  const payload = { from: this.config.from, to: [message.email], subject, text, html };
  try {
   if (this.config.mode === 'resend') {
    const response = await this.request('https://api.resend.com/emails', {
     method: 'POST', headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': message.challengeId },
     body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000),
    });
    // Never surface provider response bodies: they can echo addresses or message content.
    await response.body?.cancel();
    if (!response.ok) throw new Error('Delivery failed');
   } else {
    const write = this.pendingOutbox.then(async () => {
     const dir = this.config.outboxDir || resolve('.local/account-mail');
     await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700);
     const files = (await readdir(dir)).filter(name => /^[0-9a-f-]{36}\.json$/i.test(name));
     const entries = await Promise.all(files.map(async name => ({ name, time: (await stat(join(dir, name))).mtimeMs })));
     entries.sort((a, b) => a.time - b.time);
     for (const entry of entries.slice(0, Math.max(0, entries.length - 99))) await unlink(join(dir, entry.name));
     await writeFile(join(dir, `${message.challengeId}.json`), JSON.stringify(payload, null, 2), { mode: 0o600, flag: 'wx' });
    });
    this.pendingOutbox = write.catch(() => {});
    await write;
   }
  } catch { throw new Error('Account email delivery is unavailable. Please try again later.'); }
 }
}
