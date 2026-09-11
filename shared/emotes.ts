import type { SharedEmoteKind } from './emotePoses.ts';
export const EMOTE_REACH = 2;
export const EMOTE_INVITE_MS = 12_000;
export type EmoteInvitation = { id: string; kind: SharedEmoteKind; fromId: string; fromName: string; toId: string; toName: string; expiresAt: number };
export type EmoteInbox = { serverTime: number; incoming: EmoteInvitation | null; outgoing: EmoteInvitation | null };
export type EmoteCommand = { action: 'request'; targetId: string; kind: SharedEmoteKind } | { action: 'accept' | 'decline'; id: string } | { action: 'cancel' } | { action: 'sync' };
