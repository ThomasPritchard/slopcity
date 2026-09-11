import { ServerError } from '@colyseus/core';
import type { SafetyBan, SafetyEvent, SafetyPlayer, SafetySnapshot } from '../shared/safety.ts';
import { CAPACITY } from '../shared/world.ts';
import { networkKey, normalizeIP } from './clientAddress.ts';
import { validProfileId } from './persistence/guests.ts';
import type { SafetyRepository } from './persistence/safety.ts';

export class SafetyError extends ServerError {
 constructor(public status: number, public codeName: string, message: string, public retryAfter = 60) { super(status, message); }
}

// Bounded, continuous-refill quotas. Rejected requests do not extend a cooldown.
export class TokenBucket {
 private buckets = new Map<string, { tokens: number; at: number }>();
 private sweepAt = 0;
 constructor(readonly maximum: number, readonly windowMs: number, private capacity = 4096) {}
 take(key: string, now = Date.now()): boolean {
  if (now >= this.sweepAt) { for (const [id, b] of this.buckets) if (now - b.at >= this.windowMs) this.buckets.delete(id); this.sweepAt = now + Math.min(30_000, this.windowMs); }
  let b = this.buckets.get(key);
  if (!b) { if (this.buckets.size >= this.capacity) return false; b = { tokens: this.maximum, at: now }; this.buckets.set(key,b); }
  b.tokens = Math.min(this.maximum, b.tokens + Math.max(0, now - b.at) * this.maximum / this.windowMs); b.at = now;
  if (b.tokens < 1) return false;
  b.tokens--; return true;
 }
}

export const SAFETY_LIMITS = {
 guest: { ip: 10, global: 120, window: 15 * 60_000 },
 join: { ip: 30, global: 120, window: 60_000 },
 upgrade: { ip: 40, global: 180, window: 60_000 },
 api: { ip: 600, global: 6000, window: 60_000 },
 voice: { ip: 60, global: 240, window: 60_000 },
 concurrentIP: 12,
 messagesPerSecond: 120,
};
type LimitKind = 'guest' | 'join' | 'upgrade' | 'api' | 'voice';
type Connection = SafetyPlayer & { disconnect: () => void };

export class SafetyService {
 readonly startedAt: number;
 private bans: SafetyBan[] = [];
 private connections = new Map<string, Connection>();
 private counters = new Map<string, number>();
 private events: SafetyEvent[] = [];
 private limiters = new Map<LimitKind, { ip: TokenBucket; global: TokenBucket }>();
 private guestJoin = new TokenBucket(12,60_000);
 private voiceGuest = new TokenBucket(6,60_000);
 private edits: Promise<unknown> = Promise.resolve();
 private logger?: ReturnType<typeof setInterval>;
 constructor(readonly repository: SafetyRepository, private readonly now = Date.now) {
  this.startedAt = now();
  for (const kind of ['guest','join','upgrade','api','voice'] as const) { const c = SAFETY_LIMITS[kind]; this.limiters.set(kind,{ip:new TokenBucket(c.ip,c.window),global:new TokenBucket(c.global,c.window)}); }
 }
 async initialise() { await this.repository.initialise(); this.bans = await this.repository.active(); }
 startLogging() {
  this.logger = setInterval(() => console.info(JSON.stringify({event:'town_safety_summary',at:this.now(),startedAt:this.startedAt,activeConnections:this.connections.size,counters:Object.fromEntries(this.counters)})),60_000);
  this.logger.unref();
 }
 stopLogging() { if (this.logger) clearInterval(this.logger); }
 count(type: string) { this.counters.set(type,(this.counters.get(type)??0)+1); }
 record(type: string, ip?: string, profileId?: string) {
  this.count(type);
  const now = this.now(), last = this.events.find(e => e.type === type && e.ip === ip && e.profileId === profileId && now-e.at<10_000);
  if (last) { last.count++; return; }
  this.events.unshift({at:now,type,ip,profileId,count:1}); this.events.length = Math.min(200,this.events.length);
 }
 isBanned(ip?: string, profileId?: string): boolean {
  const now = this.now();
  return this.bans.some(b => (b.expiresAt === null || b.expiresAt > now) && (b.kind === 'ip' ? b.target === ip : b.target === profileId));
 }
 checkBan(ip: string, profileId?: string) {
  if (this.isBanned(ip,profileId)) { this.record('ban_rejected',ip,profileId); throw new SafetyError(403,'banned','Access to Slop City is currently restricted.'); }
 }
 limit(kind: LimitKind, ip: string, profileId?: string) {
  const limiter = this.limiters.get(kind)!, now = this.now();
  // Network limit first: a single source cannot drain the global bucket after exhausting its own.
  if (!limiter.ip.take(networkKey(ip),now) || !limiter.global.take('all',now) || (profileId && kind === 'join' && !this.guestJoin.take(profileId,now)) || (profileId && kind === 'voice' && !this.voiceGuest.take(profileId,now))) {
   this.record(`${kind}_rate_limited`,ip,profileId);
   throw new SafetyError(429,'rate_limit','Too many requests. Please wait before trying again.',Math.ceil(SAFETY_LIMITS[kind].window/SAFETY_LIMITS[kind].ip/1000));
  }
 }
 connect(player: Omit<SafetyPlayer,'joinedAt'>, disconnect: () => void) {
  this.checkBan(player.ip,player.profileId);
  if (this.connections.size >= CAPACITY || [...this.connections.values()].filter(p => networkKey(p.ip)===networkKey(player.ip)).length >= SAFETY_LIMITS.concurrentIP) {
   this.record('connection_limit',player.ip,player.profileId); throw new SafetyError(429,'connection_limit','This connection limit has been reached. Please try again later.');
  }
  this.connections.set(player.sessionId,{...player,joinedAt:this.now(),disconnect});
 }
 limitGuestJoin(ip: string, profileId: string) {
  if(!this.guestJoin.take(profileId,this.now())) { this.record('join_rate_limited',ip,profileId); throw new SafetyError(429,'rate_limit','Please wait before rejoining the town.',5); }
 }
 joined(sessionId: string) { const p=this.connections.get(sessionId); if (p) { this.checkBan(p.ip,p.profileId); this.record('join_accepted',p.ip,p.profileId); } }
 disconnect(sessionId: string) { this.connections.delete(sessionId); }
 eventFor(sessionId: string, type: string) { const p=this.connections.get(sessionId); if(p)this.record(type,p.ip,p.profileId); }
 private serial<T>(work:()=>Promise<T>):Promise<T> { const pending=this.edits.then(work); this.edits=pending.catch(()=>{}); return pending; }
 addBan(value: unknown): Promise<SafetyBan> {
  const v=value as Record<string,unknown> | null;
  if (!v || !['ip','guest'].includes(String(v.kind)) || typeof v.target!=='string' || typeof v.reason!=='string' || !v.reason.trim() || v.reason.trim().length>240 || (v.durationMinutes!==null && (!Number.isInteger(v.durationMinutes) || Number(v.durationMinutes)<1 || Number(v.durationMinutes)>525600))) throw new SafetyError(400,'invalid_ban','Enter a target, a reason up to 240 characters and a valid duration.');
  const kind=v.kind as SafetyBan['kind'], target=kind==='ip'?normalizeIP(v.target.trim()):validProfileId(v.target.trim())?v.target.trim().toLowerCase():null;
  if (!target) throw new SafetyError(400,'invalid_target',kind==='ip'?'Enter one IPv4 or IPv6 address (no network ranges).':'Enter a valid guest ID.');
  return this.serial(async()=>{
   const ban=await this.repository.add(kind,target,v.reason!.toString().trim(),v.durationMinutes as number|null);
   this.bans=this.bans.filter(b=>(b.expiresAt===null||b.expiresAt>this.now())&&!(b.kind===kind&&b.target===target));
   this.bans.unshift(ban); this.record('admin_ban');
   for (const p of this.connections.values()) if(this.isBanned(p.ip,p.profileId))p.disconnect();
   return ban;
  });
 }
 revokeBan(id: string): Promise<void> {
  if(!validProfileId(id))throw new SafetyError(400,'invalid_ban','Invalid ban ID.');
  return this.serial(async()=>{await this.repository.revoke(id);this.bans=this.bans.filter(b=>b.id!==id);this.record('admin_unban');});
 }
 snapshot(): SafetySnapshot {
  const now=this.now();
  return {startedAt:this.startedAt,now,metrics:[...this.counters].map(([name,count])=>({name,count})),recentEvents:this.events.filter(e=>now-e.at<24*60*60_000).map(e=>({...e})),players:[...this.connections.values()].map(({disconnect,...p})=>p),bans:this.bans.filter(b=>b.expiresAt===null||b.expiresAt>now),limits:[
   {name:'New guests per network',value:'10 per 15 minutes'}, {name:'New guests globally',value:'120 per 15 minutes'}, {name:'Join requests',value:'30 per network / 120 globally per minute'}, {name:'Connections',value:`12 per network / ${CAPACITY} globally`}, {name:'Game messages',value:'120 per second per connection'}, {name:'Voice token requests',value:'6 per guest per minute'},
  ]};
 }
}
