import { CASINO_READY_LEAD_MS, CASINO_JOIN_GRACE_MS, type CasinoReadiness } from '../../shared/casino.ts';

/** In-memory intent only. Callers supply committed, session-bound participants. */
export class RoundPacing {
 private round = '';
 private ready = new Map<string, string>();
 private viewers = new Map<string, { sessionId: string; until: number }>();
 private seen = new Set<string>();
 private firstReady: number | null = null;
 private countdown = 0;
 constructor(private now: () => number) {}
 reset(round: string) {
  if (this.round === round) return;
  this.round = round; this.ready.clear(); this.seen.clear(); this.firstReady = null; this.countdown = 0;
  // Existing spectators do not receive a fresh joining grace every round.
  for (const [id, viewer] of this.viewers) { viewer.until = 0; this.seen.add(id); }
 }
 presence(profileId: string, sessionId: string, viewing: boolean) {
  if (!viewing) { this.viewers.delete(profileId); return; }
  if (!this.seen.has(profileId)) {
   this.seen.add(profileId);
   this.viewers.set(profileId, { sessionId, until: this.now() + CASINO_JOIN_GRACE_MS });
  }
 }
 depart(profileId: string) { this.viewers.delete(profileId); this.ready.delete(profileId); }
 mark(profileId: string, sessionId: string) {
  if (this.ready.get(profileId) === sessionId) return;
  this.ready.set(profileId, sessionId); this.firstReady ??= this.now();
 }
 changed(profileId: string) { this.ready.delete(profileId); this.countdown = 0; }
 state(participants: Map<string, string>, fallback: number, minimum: number, viewerConnected: (id: string, sessionId: string) => boolean): CasinoReadiness {
  for (const [id, sessionId] of this.ready) if (participants.get(id) !== sessionId) this.ready.delete(id);
  const readyProfileIds = [...this.ready.keys()];
  const allReady = participants.size >= minimum && readyProfileIds.length === participants.size;
  if (!allReady) this.countdown = 0;
  else if (!this.countdown) this.countdown = this.now() + CASINO_READY_LEAD_MS;
  let deadline = this.countdown;
  if (deadline) for (const [id, viewer] of this.viewers) {
   if (!viewerConnected(id, viewer.sessionId)) { this.viewers.delete(id); continue; }
   if (!participants.has(id)) deadline = Math.max(deadline, Math.min(viewer.until, this.firstReady! + CASINO_JOIN_GRACE_MS));
  }
  return { players: participants.size, readyProfileIds, deadline: deadline && fallback ? Math.min(deadline, fallback) : deadline };
 }
}
