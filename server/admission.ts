import { createHash, randomUUID } from 'node:crypto';
import type { AdmissionMode, AdmissionStatus } from '../shared/admission.ts';
import type { AdmissionRepository } from './persistence/admission.ts';
import { validProfileId } from './persistence/guests.ts';
import { parseGuestCookie } from './guest.ts';
import { networkKey } from './clientAddress.ts';
import { SafetyError, TokenBucket } from './safety.ts';

type Config = { siteKey: string; secret: string; hostnames: string[] };
export function turnstileConfig(env = process.env): Config {
 const siteKey = env.TURNSTILE_SITE_KEY?.trim() ?? '', secret = env.TURNSTILE_SECRET_KEY?.trim() ?? '';
 const origins = [env.APP_ORIGIN ?? 'http://localhost:5173', ...(env.APP_ORIGINS ?? '').split(',').filter(Boolean)];
 const hostnames = origins.map(v => new URL(v.trim()).hostname);
 const publicOrigin = hostnames.some(h => h !== 'localhost' && h !== '127.0.0.1' && !h.endsWith('.localhost'));
 const enabled = env.TURNSTILE_ENABLED?.trim().toLowerCase();
 if (enabled && enabled !== 'true' && enabled !== 'false') throw new Error('TURNSTILE_ENABLED must be true or false');
 if (enabled === 'false') {
  if (env.NODE_ENV === 'production' || publicOrigin) throw new Error('TURNSTILE_ENABLED=false is only allowed for loopback development');
  return { siteKey: '', secret: '', hostnames };
 }
 // The disposable HTTPS smoke stack uses production containers on loopback DNS.
 // A public production hostname can never opt out or use Cloudflare's dummy keys.
 const publicProduction = env.NODE_ENV === 'production' && publicOrigin;
 if ((enabled === 'true' && !siteKey) || !!siteKey !== !!secret || (publicProduction && (!siteKey || /^[123]x0{10}/.test(siteKey) || /^[123]x0{10}/.test(secret)))) throw new Error('Configure a real TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY pair for production');
 return { siteKey, secret, hostnames };
}
type Grant = { credential: string; expires: number; reservation?: string };
type Connection = { profileId: string; credential: string; notify(deadline: number): void; disconnect(): void; deadline?: number };
const required = () => new SafetyError(403,'verification_required','Please complete the entry check and try again.');
const credential = (cookie: string | undefined) => { const secret = parseGuestCookie(cookie); return secret ? createHash('sha256').update(secret).digest('hex') : ''; };

export class AdmissionService {
 private mode: AdmissionMode = 'open';
 private approved = new Set<string>();
 private grants = new Map<string, Grant>();
 private connections = new Map<string, Connection>();
 private generation = 0;
 private inFlight = 0;
 private globalChecks = new TokenBucket(240,60_000);
 private networkChecks = new TokenBucket(20,60_000);
 private edits: Promise<unknown> = Promise.resolve();
 private timer?: ReturnType<typeof setInterval>;
 constructor(readonly config: Config, readonly repository: AdmissionRepository, private readonly fetcher: typeof fetch = fetch, private readonly now = Date.now) {}
 get enabled() { return !!this.config.secret; }
 async initialise() { await this.repository.initialise(); const state = await this.repository.load(); this.mode = state.mode; this.approved = new Set(state.approved); }
 start() { this.timer = setInterval(() => this.expire(),1000); this.timer.unref(); }
 stop() { clearInterval(this.timer); }
 expire() {
  for (const [id,g] of this.grants) if (g.expires <= this.now()) this.grants.delete(id);
  for (const [id,c] of this.connections) if (c.deadline && c.deadline <= this.now()) { this.connections.delete(id); c.disconnect(); }
 }
 status(profileId?: string, cookie?: string): AdmissionStatus {
  const g = profileId ? this.grants.get(profileId) : undefined;
  return { enabled: this.enabled, siteKey: this.config.siteKey, mode: this.mode, verified: !!g && !g.reservation && g.expires > this.now() && g.credential === credential(cookie) };
 }
 checkMode(profileId?: string) {
  if (this.mode === 'paused') throw new SafetyError(403,'entry_paused','Town entry is temporarily paused. Please try again shortly.');
  if (profileId && this.mode === 'approved' && !this.approved.has(profileId)) throw new SafetyError(403,'approval_required','Town entry is currently limited to approved guests. Ask the host to approve your guest name.');
 }
 async verify(token: unknown, ip: string): Promise<number> {
  const generation = this.generation;
  if (!this.enabled) return generation;
  if (typeof token !== 'string' || !token.length || token.length > 2048) throw required();
  if (!this.networkChecks.take(networkKey(ip),this.now()) || !this.globalChecks.take('all',this.now()) || this.inFlight >= 16) throw new SafetyError(429,'verification_limited','Too many entry checks. Please wait a minute and retry.');
  this.inFlight++;
  try {
   const response = await this.fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', headers: {'Content-Type':'application/json'}, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ secret: this.config.secret, response: token, remoteip: ip, idempotency_key: randomUUID() }),
   });
   if (!response.ok) throw new Error('Provider unavailable');
   const result = await response.json();
   if (result.success !== true || !this.config.hostnames.includes(result.hostname) || result.action !== 'town_entry') throw required();
   if (generation !== this.generation) throw required();
   return generation;
  } catch (error) {
   if (error instanceof SafetyError) throw error;
   throw new SafetyError(503,'verification_unavailable','The entry check is unavailable. Please retry in a moment.');
  } finally { this.inFlight--; }
 }
 issue(profileId: string, cookie: string | undefined, generation: number) {
  if (generation !== this.generation) throw required();
  const hash = credential(cookie);
  if (!hash) throw required();
  // An in-town check renews only the active connection, never a second admission.
  for (const c of this.connections.values()) if (c.profileId === profileId && c.credential === hash) { c.deadline = undefined; return; }
  this.expire();
  if (!this.grants.has(profileId) && this.grants.size >= 4096) throw new SafetyError(503,'entry_busy','Entry is busy. Please try again shortly.');
  this.grants.set(profileId,{credential:hash,expires:this.now()+15*60_000});
 }
 reserve(profileId: string, cookie: string | undefined): string | undefined {
  this.checkMode(profileId);
  if (!this.enabled) return;
  const g = this.grants.get(profileId);
  if (!g || g.reservation || g.expires <= this.now() || g.credential !== credential(cookie)) throw required();
  g.reservation = randomUUID(); g.expires = Math.min(g.expires,this.now()+30_000);
  return g.reservation;
 }
 checkUpgrade(profileId: string, cookie: string | undefined) {
  this.checkMode(profileId);
  if (!this.enabled) return;
  const g = this.grants.get(profileId);
  if (!g?.reservation || g.expires <= this.now() || g.credential !== credential(cookie)) throw required();
 }
 consume(profileId: string, cookie: string | undefined, reservation?: string) {
  this.checkUpgrade(profileId,cookie);
  if (this.enabled && (!reservation || this.grants.get(profileId)?.reservation !== reservation)) throw required();
  this.grants.delete(profileId);
 }
 connect(sessionId: string, profileId: string, cookie: string | undefined, notify: Connection['notify'], disconnect: Connection['disconnect']) { this.connections.set(sessionId,{profileId,credential:credential(cookie),notify,disconnect}); }
 disconnect(sessionId: string) { this.connections.delete(sessionId); }
 async snapshot() { return {enabled:this.enabled,mode:this.mode,approved:await this.repository.approved(),pending:[...this.connections.values()].filter(c=>c.deadline).length}; }
 async edit(action: unknown, target: unknown): Promise<void> {
  if (!['mode','approve','revoke','reverify'].includes(String(action)) || typeof target !== 'string' || (action === 'mode' && !['open','paused','approved'].includes(target)) || ((action === 'approve' || action === 'revoke') && !validProfileId(target)) || (action === 'reverify' && (target !== 'all' || !this.enabled))) throw new SafetyError(400,'invalid_control','Choose a valid entry control. Reverification requires Turnstile.');
  const operation = this.edits.then(async () => {
   await this.repository.edit(action as 'mode'|'approve'|'revoke'|'reverify',target);
   if (action === 'mode') this.mode = target as AdmissionMode;
   if (action === 'approve') this.approved.add(target);
   if (action === 'revoke') this.approved.delete(target);
   this.generation++; this.grants.clear();
   if (action === 'reverify') for (const c of this.connections.values()) { c.deadline = this.now()+120_000; c.notify(c.deadline); }
  });
  this.edits = operation.catch(()=>{}); return operation;
 }
}
