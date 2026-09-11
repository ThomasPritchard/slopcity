// Private administration contracts. Never replicate these in TownState.
export type SafetyBan = { id: string; kind: 'ip' | 'guest'; target: string; reason: string; createdAt: number; expiresAt: number | null };
export type SafetyPlayer = { sessionId: string; profileId: string; name: string; ip: string; joinedAt: number };
export type SafetyGuest = { profileId: string; name: string; createdAt: number };
export type SafetyEvent = { at: number; type: string; ip?: string; profileId?: string; count: number };
export type SafetySnapshot = { startedAt: number; now: number; metrics: { name: string; count: number }[]; recentEvents: SafetyEvent[]; players: SafetyPlayer[]; bans: SafetyBan[]; limits: { name: string; value: string }[] };
