import { district, type Position } from './world.ts';
export const VOICE_RANGE = 12;
export const VOICE_RELEASE_RANGE = 14;
export type VoiceNeighbour = { sessionId: string; gain: number };
export function voiceGain(listener: Position, speaker: Position, alreadyEligible = false): number | null {
  if (district(listener.x, listener.z) !== district(speaker.x, speaker.z)) return null;
  const distance = Math.hypot(listener.x - speaker.x, listener.z - speaker.z);
  if (distance > (alreadyEligible ? VOICE_RELEASE_RANGE : VOICE_RANGE)) return null;
  return Math.max(0, Math.min(1, (VOICE_RANGE - distance) / (VOICE_RANGE - 2)));
}
