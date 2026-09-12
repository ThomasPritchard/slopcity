import { CASINO_ANCHORS, CASINO_INTERACTION_RADIUS, type CasinoTableId } from './casino.ts';

export const CHAT_HISTORY_LIMIT = 300;
export type ChatChannel = 'town' | 'table' | 'whisper';
export type ChatCommand = { body: string } & (
  | { channel: 'town' }
  | { channel: 'table'; tableId: CasinoTableId }
  | { channel: 'whisper'; toProfileId: string }
);
export type ChatMessage = {
  id: string; sentAt: number; profileId: string; name: string; body: string;
  channel: ChatChannel; tableId?: CasinoTableId; toProfileId?: string; toName?: string;
};

export function isChatTable(value: unknown): value is CasinoTableId {
  return typeof value === 'string' && CASINO_ANCHORS.some(table => table.id === value);
}

/** Legacy clients can still send town strings. Malformed destinations never become public chat. */
export function parseChatCommand(value: unknown): ChatCommand | null {
  if (typeof value === 'string') return { channel: 'town', body: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.body !== 'string') return null;
  if (v.channel === 'town') return { channel: 'town', body: v.body };
  if (v.channel === 'table' && isChatTable(v.tableId)) return { channel: 'table', tableId: v.tableId, body: v.body };
  if (v.channel === 'whisper' && typeof v.toProfileId === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v.toProfileId)) return { channel: 'whisper', toProfileId: v.toProfileId, body: v.body };
  return null;
}

/** Use authoritative position/seat state on the server, including for recipients. */
export function chatTableFor(player: { x: number; z: number; seatId: string }, viewing?: CasinoTableId | null): CasinoTableId | null {
  const seated = player.seatId.startsWith('casino:') ? player.seatId.split(':')[1] : null;
  if (isChatTable(seated)) return seated;
  const table = CASINO_ANCHORS.find(table => table.id === viewing);
  return table && Math.hypot(player.x - table.x, player.z - table.z) <= CASINO_INTERACTION_RADIUS ? table.id : null;
}
