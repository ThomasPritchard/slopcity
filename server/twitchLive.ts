import { BRIDGEMIND_TWITCH_CHANNEL } from '../shared/community.ts';

export type TwitchLiveStatus = 'checking' | 'live' | 'offline' | 'unknown' | 'unconfigured';
export interface TwitchLiveSnapshot {
 status: TwitchLiveStatus;
 isLive: boolean | null;
 checkedAt: number | null;
 streamId: string | null;
}
export interface TwitchLiveOptions {
 clientId?: string;
 clientSecret?: string;
 fetch?: typeof fetch;
 now?: () => number;
 pollMs?: number;
 timeoutMs?: number;
}
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const STREAMS_URL = `https://api.twitch.tv/helix/streams?user_login=${BRIDGEMIND_TWITCH_CHANNEL}`;
const HOUR = 60 * 60 * 1000;

/** Observes public broadcast state using a server-only Twitch app token. */
export class TwitchLiveService {
 private readonly clientId: string;
 private readonly clientSecret: string;
 private readonly fetcher: typeof fetch;
 private readonly now: () => number;
 private readonly pollMs: number;
 private readonly timeoutMs: number;
 private state: TwitchLiveSnapshot;
 private token = '';
 private expiresAt = 0;
 private validatedAt = -Infinity;
 private retryAt = 0;
 private emptyResponses = 0;
 private running = false;
 private stopped = false;
 private timer?: ReturnType<typeof setTimeout>;
 private controller?: AbortController;
 private requestTimeout?: ReturnType<typeof setTimeout>;
 private generation = 0;
 private inFlight?: Promise<void>;

 constructor(options: TwitchLiveOptions = {}) {
  this.clientId = options.clientId ?? process.env.TWITCH_CLIENT_ID ?? '';
  this.clientSecret = options.clientSecret ?? process.env.TWITCH_CLIENT_SECRET ?? '';
  this.fetcher = options.fetch ?? globalThis.fetch;
  this.now = options.now ?? Date.now;
  this.pollMs = Math.max(1, options.pollMs ?? 30_000);
  this.timeoutMs = Math.max(1, options.timeoutMs ?? 8_000);
  this.state = { status: this.configured ? 'checking' : 'unconfigured', isLive: null, checkedAt: null, streamId: null };
 }
 private get configured() { return !!this.clientId && !!this.clientSecret; }
 snapshot(): TwitchLiveSnapshot { return { ...this.state }; }
 start(): void {
  if (this.running || !this.configured) return;
  this.running = true;
  this.stopped = false;
  void this.refresh();
 }
 stop(): void {
  this.running = false;
  this.stopped = true;
  this.generation++;
  if (this.requestTimeout) clearTimeout(this.requestTimeout);
  this.requestTimeout = undefined;
  if (this.timer) clearTimeout(this.timer);
  this.timer = undefined;
  this.controller?.abort();
 }
 refresh(): Promise<void> {
  if (this.inFlight) return this.inFlight;
  if (!this.configured || this.stopped) return Promise.resolve();
  if (this.timer) clearTimeout(this.timer);
  this.timer = undefined;
  this.inFlight = this.poll().finally(() => {
   this.inFlight = undefined;
   this.controller = undefined;
   if (this.running) {
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, Math.min(2_147_483_647, Math.max(this.pollMs, this.retryAt - this.now())));
    this.timer.unref();
   }
  });
  return this.inFlight;
 }
 private async request(url: string, init: RequestInit, signal: AbortSignal): Promise<{ status: number; body: any }> {
  const response = await this.fetcher(url, { ...init, signal, redirect: 'error' });
  if (response.status === 429) {
   const reset = Number(response.headers.get('Ratelimit-Reset')) * 1000;
   this.retryAt = Math.max(this.now() + this.pollMs, Number.isFinite(reset) ? reset : 0);
   throw new Error('Twitch rate limit');
  }
  if (!response.ok) return { status: response.status, body: null };
  return { status: response.status, body: await response.json() };
 }
 private async acquireToken(signal: AbortSignal): Promise<void> {
  this.token = '';
  const result = await this.request(TOKEN_URL, {
   method: 'POST',
   body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, grant_type: 'client_credentials' }),
  }, signal);
  if (result.status !== 200 || typeof result.body?.access_token !== 'string' || !result.body.access_token || !Number.isFinite(result.body.expires_in) || result.body.expires_in <= 0) throw new Error('Twitch authentication unavailable');
  this.token = result.body.access_token;
  this.expiresAt = this.now() + result.body.expires_in * 1000;
  this.validatedAt = -Infinity;
 }
 private async validateToken(signal: AbortSignal): Promise<boolean> {
  const result = await this.request(VALIDATE_URL, { headers: { Authorization: `OAuth ${this.token}` } }, signal);
  if (result.status === 401) { this.token = ''; return false; }
  if (result.status !== 200 || result.body?.client_id !== this.clientId || !Number.isFinite(result.body.expires_in) || result.body.expires_in <= 0) throw new Error('Twitch token validation unavailable');
  this.expiresAt = this.now() + result.body.expires_in * 1000;
  this.validatedAt = this.now();
  return true;
 }
 private async poll(): Promise<void> {
  if (this.now() < this.retryAt) return;
  const generation = this.generation;
  const controller = new AbortController();
  this.controller = controller;
  const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
  this.requestTimeout = timeout;
  try {
   if (!this.token || this.expiresAt <= this.now() + 60_000) await this.acquireToken(controller.signal);
   if (this.now() - this.validatedAt >= HOUR && !await this.validateToken(controller.signal)) {
    await this.acquireToken(controller.signal);
    if (!await this.validateToken(controller.signal)) throw new Error('Twitch token rejected');
   }
   const streams = () => this.request(STREAMS_URL, { headers: { Authorization: `Bearer ${this.token}`, 'Client-Id': this.clientId } }, controller.signal);
   let result = await streams();
   if (result.status === 401) {
    await this.acquireToken(controller.signal);
    if (!await this.validateToken(controller.signal)) throw new Error('Twitch token rejected');
    result = await streams();
   }
   if (result.status !== 200 || !Array.isArray(result.body?.data)) throw new Error('Twitch stream status unavailable');
   if (controller.signal.aborted || generation !== this.generation) throw new Error('Twitch request aborted');
   const stream = result.body.data[0];
   if (stream !== undefined) {
    if (typeof stream.id !== 'string' || !stream.id || stream.user_login?.toLowerCase() !== BRIDGEMIND_TWITCH_CHANNEL || stream.type !== 'live') throw new Error('Invalid Twitch stream status');
    this.emptyResponses = 0;
    this.state = { status: 'live', isLive: true, checkedAt: this.now(), streamId: stream.id };
   } else {
    this.emptyResponses++;
    this.state = this.emptyResponses >= 2
     ? { status: 'offline', isLive: false, checkedAt: this.now(), streamId: null }
     : { ...this.state, status: this.state.isLive === true ? 'live' : 'checking', checkedAt: this.now() };
   }
  } catch {
   if (!this.stopped && generation === this.generation) {
    this.emptyResponses = 0;
    this.state = { ...this.state, status: 'unknown', checkedAt: this.now() };
   }
  } finally { clearTimeout(timeout); this.requestTimeout = undefined; }
 }
}
