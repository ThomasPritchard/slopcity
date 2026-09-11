import { SHOP_OVERHEAD } from './shopLayout.ts';
export const SPRINT_MULTIPLIER = 1.5;
export const HOP_DURATION_MS = 600;
export const HOP_COOLDOWN_MS = 850;
export const HOP_HEIGHT = .48;
export const PLAYER_HEIGHT = 2.05;

export function isHopping(startedAt: number, now: number) {
  return startedAt > 0 && now >= startedAt && now < startedAt + HOP_DURATION_MS;
}
export function hopHeight(startedAt: number, now: number) {
  if (!isHopping(startedAt, now)) return 0;
  const t = (now - startedAt) / HOP_DURATION_MS;
  return 4 * HOP_HEIGHT * t * (1 - t);
}

// Shared body-clearance bounds also drive the camera's invisible overhead solids.
export const OVERHEAD_SOLIDS = [
  ...SHOP_OVERHEAD,
  { name: 'entrance canopy', x: 0, z: 12.95, w: 39.6, d: 3.5, bottom: 3.86, top: 4.65 },
  { name: 'foyer ceiling', x: 0, z: 19.2, w: 40, d: 10.4, bottom: 3.94, top: 4.6 },
  { name: 'hall ceiling', x: 0, z: 40.2, w: 40, d: 31.6, bottom: 7.76, top: 8.5 },
  { name: 'stair portal', x: 0, z: 24.4, w: 12, d: .44, bottom: 3.8, top: 8.2 },
  { name: 'ramp doorway lintel', x: 7, z: 21.5, w: .32, d: 1.6, bottom: 2.8, top: 4 },
  { name: 'chandelier', x: 0, z: 38, w: 5.2, d: 5.2, bottom: 5.1, top: 7.8 },
] as const;
