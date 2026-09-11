import { randomUUID } from 'node:crypto';
import { EMOTE_POSES, type SharedEmoteKind } from '../shared/emotePoses.ts';
import { EMOTE_INVITE_MS, EMOTE_REACH, type EmoteInbox, type EmoteInvitation } from '../shared/emotes.ts';
import { clearOfBenches, hasBodyClearance, isWalkable, type Position } from '../shared/world.ts';
import { floorHeight } from '../shared/casinoLayout.ts';
import { isHopping } from '../shared/mobility.ts';

export type EmoteCitizen = Position & { profileId: string; name: string; heading: number; seatId: string; jumpAt: number; moving: boolean; sprinting: boolean; emoteId: string; emoteKind: string; emoteRole: number; emoteAt: number };
type Invite = EmoteInvitation & { fromSession: string; toSession: string };
type Pair = { a: string; b: string; until: number };
type Hooks = {
  players(): Iterable<[string, EmoteCitizen]>;
  blocked(a: string, b: string): boolean;
  busy(id: string): boolean;
  inbox(id: string, value: EmoteInbox): void;
  notice(id: string, text: string): void;
  stopInput(id: string): void;
};

// Placement is short, swept, level and server-owned; acceptance never navigates around furniture.
export function emotePlacement(a: Position, b: Position, kind: SharedEmoteKind, others: Iterable<Position>) {
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  if (!Number.isFinite(distance) || distance < .1 || distance > EMOTE_REACH) return null;
  const ux = (b.x - a.x) / distance, uz = (b.z - a.z) / distance;
  const half = EMOTE_POSES[kind].distance / 2, cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
  const first = { x: cx - ux * half, z: cz - uz * half, heading: Math.atan2(ux, uz) };
  const second = { x: cx + ux * half, z: cz + uz * half, heading: Math.atan2(-ux, -uz) };
  const floor = floorHeight(a.x, a.z), crowd = [...others];
  if (Math.abs(floorHeight(b.x, b.z) - floor) > .025) return null;
  for (const [from, to] of [[a, first], [b, second]]) {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .05));
    for (let i = 0; i <= steps; i++) {
      const x = from.x + (to.x - from.x) * i / steps, z = from.z + (to.z - from.z) * i / steps;
      if (!isWalkable(x, z) || !clearOfBenches(x, z) || !hasBodyClearance(x, z) || Math.abs(floorHeight(x, z) - floor) > .025 || crowd.some(p => Math.hypot(p.x - x, p.z - z) < .65)) return null;
      // Paired arms need more room than the normal walking footprint.
      for (const [dx, dz] of [[.35, 0], [-.35, 0], [0, .35], [0, -.35], [.25, .25], [-.25, .25], [.25, -.25], [-.25, -.25]]) {
        if (!isWalkable(x + dx, z + dz) || !clearOfBenches(x + dx, z + dz) || !hasBodyClearance(x + dx, z + dz)) return null;
      }
    }
  }
  return [first, second] as const;
}

export class SharedEmotes {
  private invitations = new Map<string, Invite>();
  private pairs = new Map<string, Pair>();
  private requestedAt = new Map<string, number>();
  constructor(private hooks: Hooks, private now = Date.now) {}
  private players() { return new Map(this.hooks.players()); }
  private unavailable(id: string, p: EmoteCitizen | undefined) {
    return !p || !!p.seatId || this.hooks.busy(id) || isHopping(p.jumpAt, this.now());
  }
  sync(id: string) {
    const invitations = [...this.invitations.values()];
    const publicInvite = (value: Invite | undefined): EmoteInvitation | null => value ? { id: value.id, kind: value.kind, fromId: value.fromId, fromName: value.fromName, toId: value.toId, toName: value.toName, expiresAt: value.expiresAt } : null;
    this.hooks.inbox(id, { serverTime: this.now(), incoming: publicInvite(invitations.find(i => i.toSession === id)), outgoing: publicInvite(invitations.find(i => i.fromSession === id)) });
  }
  private removeInvite(invite: Invite) {
    this.invitations.delete(invite.id);
    this.sync(invite.fromSession); this.sync(invite.toSession);
  }
  cancelFor(id: string) {
    for (const invite of [...this.invitations.values()]) if (invite.fromSession === id || invite.toSession === id) this.removeInvite(invite);
    const players = this.players();
    for (const [key, pair] of this.pairs) if (pair.a === id || pair.b === id) {
      this.pairs.delete(key);
      for (const session of [pair.a, pair.b]) {
        const citizen = players.get(session);
        if (citizen?.emoteId === key) Object.assign(citizen, { emoteId: '', emoteKind: '', emoteRole: 0, emoteAt: 0, moving: false, sprinting: false });
        this.hooks.stopInput(session);
      }
    }
  }
  leave(id: string) { this.cancelFor(id); this.requestedAt.delete(id); }
  handle(id: string, value: unknown) {
    if (!value || typeof value !== 'object') return;
    const command = value as Record<string, unknown>;
    if (command.action === 'sync') { this.sync(id); return; }
    if (command.action === 'cancel') { this.cancelFor(id); return; }
    const players = this.players(), actor = players.get(id);
    if (!actor) return;
    if (command.action === 'decline' && typeof command.id === 'string') {
      const invite = this.invitations.get(command.id);
      if (invite?.toSession === id) this.removeInvite(invite);
      return;
    }
    if (command.action === 'request') {
      if (command.kind !== 'handshake' && command.kind !== 'hug' || typeof command.targetId !== 'string') return;
      if (this.now() - (this.requestedAt.get(id) ?? -Infinity) < 2500) { this.hooks.notice(id, 'Please wait a moment before another invitation.'); return; }
      this.requestedAt.set(id, this.now());
      const target = [...players].find(([, p]) => p.profileId === command.targetId);
      const pending = [...this.invitations.values()].some(i => [i.fromSession, i.toSession].some(session => session === id || session === target?.[0]));
      if (!target || target[0] === id || pending || actor.emoteId || target[1].emoteId || this.unavailable(id, actor) || this.unavailable(target[0], target[1]) || this.hooks.blocked(actor.profileId, target[1].profileId)) {
        this.hooks.notice(id, 'That neighbour is unavailable for an emote right now.'); return;
      }
      if (!emotePlacement(actor, target[1], command.kind, [...players].filter(([session]) => session !== id && session !== target[0]).map(([, p]) => p))) {
        this.hooks.notice(id, 'Stand close together in a clear, level space to share an emote.'); return;
      }
      const invite: Invite = { id: randomUUID(), kind: command.kind, fromId: actor.profileId, fromName: actor.name, toId: target[1].profileId, toName: target[1].name, fromSession: id, toSession: target[0], expiresAt: this.now() + EMOTE_INVITE_MS };
      this.invitations.set(invite.id, invite); this.sync(id); this.sync(target[0]); return;
    }
    if (command.action !== 'accept' || typeof command.id !== 'string') return;
    const invite = this.invitations.get(command.id);
    if (!invite || invite.toSession !== id) { this.hooks.notice(id, 'That invitation has ended.'); this.sync(id); return; }
    const from = players.get(invite.fromSession);
    const invalid = invite.expiresAt <= this.now() || this.unavailable(id, actor) || this.unavailable(invite.fromSession, from) || !!actor.emoteId || !!from?.emoteId || this.hooks.blocked(invite.fromId, invite.toId);
    const placement = !invalid && from ? emotePlacement(from, actor, invite.kind, [...players].filter(([session]) => session !== id && session !== invite.fromSession).map(([, p]) => p)) : null;
    this.removeInvite(invite);
    if (!placement || !from) { this.hooks.notice(id, 'The invitation ended. Move to a clear space and try again.'); return; }
    const start = this.now() + 250;
    this.pairs.set(invite.id, { a: invite.fromSession, b: id, until: start + EMOTE_POSES[invite.kind].durationMs });
    for (const [index, citizen] of [from, actor].entries()) Object.assign(citizen, placement[index], { emoteId: invite.id, emoteKind: invite.kind, emoteRole: index, emoteAt: start, moving: false, sprinting: false });
    this.hooks.stopInput(invite.fromSession); this.hooks.stopInput(id);
  }
  tick() {
    const players = this.players();
    for (const invite of [...this.invitations.values()]) {
      const a = players.get(invite.fromSession), b = players.get(invite.toSession);
      if (invite.expiresAt <= this.now() || this.unavailable(invite.fromSession, a) || this.unavailable(invite.toSession, b) || this.hooks.blocked(invite.fromId, invite.toId) || a && b && Math.hypot(a.x - b.x, a.z - b.z) > EMOTE_REACH) this.removeInvite(invite);
    }
    for (const pair of [...this.pairs.values()]) {
      const a = players.get(pair.a), b = players.get(pair.b);
      if (this.now() >= pair.until || this.unavailable(pair.a, a) || this.unavailable(pair.b, b) || a && b && this.hooks.blocked(a.profileId, b.profileId)) this.cancelFor(pair.a);
    }
  }
}
