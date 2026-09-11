export type SharedEmoteKind = 'handshake' | 'hug';

/** Matched citizen clips. Distance is root to root; playback starts at frame zero. */
export const EMOTE_POSES = {
  handshake: { label: 'Handshake', distance: 0.78, durationMs: 3200, clipA: 'HandshakeA', clipB: 'HandshakeB' },
  hug: { label: 'Hug', distance: 0.48, durationMs: 3600, clipA: 'HugA', clipB: 'HugB' },
} as const;
