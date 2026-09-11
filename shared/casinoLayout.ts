import { SHOP_LAYOUT, inShop } from './shopLayout.ts';
/** Metres in town coordinates. The network remains planar; both peers derive the same floor. */
export const CASINO_LAYOUT = {
  halfWidth: 20, front: 14, rear: 56, floor: .9,
  stairs: { halfWidth: 6, start: 22, end: 24.4, tread: .48, riser: .18 },
  ramp: { startX: 7, endX: 19, startZ: 22, endZ: 24.4 },
} as const;

export function inCasino(x: number, z: number): boolean {
  return Math.abs(x) < CASINO_LAYOUT.halfWidth && z > CASINO_LAYOUT.front && z < CASINO_LAYOUT.rear;
}

export function floorHeight(x: number, z: number): number {
  if (inShop(x, z)) return SHOP_LAYOUT.floor;
  if (!inCasino(x, z) || z <= CASINO_LAYOUT.stairs.start) return 0;
  if (z >= CASINO_LAYOUT.stairs.end) return CASINO_LAYOUT.floor;
  if (Math.abs(x) <= CASINO_LAYOUT.stairs.halfWidth) {
    return Math.min(CASINO_LAYOUT.floor, Math.ceil((z - CASINO_LAYOUT.stairs.start) / CASINO_LAYOUT.stairs.tread) * CASINO_LAYOUT.stairs.riser);
  }
  if (x >= CASINO_LAYOUT.ramp.startX) {
    return Math.min(1, (x - CASINO_LAYOUT.ramp.startX) / (CASINO_LAYOUT.ramp.endX - CASINO_LAYOUT.ramp.startX)) * CASINO_LAYOUT.floor;
  }
  return 0;
}

export const CASINO_WALLS = [
  { x: -11, z: 14, w: 18, d: .5, h: 6 },
  { x: 11, z: 14, w: 18, d: .5, h: 6 },
  { x: -20, z: 35, w: .5, d: 42, h: 8.2 },
  { x: 20, z: 35, w: .5, d: 42, h: 8.2 },
  { x: 0, z: 56, w: 40, d: .5, h: 8.2 },
  { x: -7, z: 19.2, w: .3, d: 10.4, h: 4 },
  // The framed opening at z20.7–22.3 is the foyer's access to the side ramp.
  { x: 7, z: 17.35, w: .3, d: 6.7, h: 4 },
  { x: 7, z: 23.35, w: .3, d: 2.1, h: 4 },
  { x: 7, z: 20.62, w: .36, d: .16, h: 2.8 },
  { x: 7, z: 22.38, w: .36, d: .16, h: 2.8 },
  { x: -6.575, z: 22, w: .85, d: .3, h: 4 },
  // Guardrails leave a west entrance and east exit along the sloping side ramp.
  { x: -12.925, z: 24.33, w: 13.55, d: .2, h: 1.9 },
  { x: 6.575, z: 24.33, w: .85, d: .2, h: 1.9 },
  { x: 12.4, z: 24.36, w: 10.8, d: .2, h: 1.9 },
  { x: 13.75, z: 22, w: 10.7, d: .2, h: 1.9 },
  { x: 19, z: 23.18, w: .2, d: 2.16, h: 1.9 },
  { x: -6.15, z: 23.2, w: .3, d: 2.4, h: 4 },
  { x: 6.15, z: 23.2, w: .3, d: 2.4, h: 4 },
  { x: -6.18, z: 24.4, w: .36, d: .44, h: 4 },
  { x: 6.18, z: 24.4, w: .36, d: .44, h: 4 },
] as const;

export const CASINO_FURNITURE = [
  { x: -2.68, z: 13.25, w: 1.18, d: 1.18 },
  { x: 2.68, z: 13.25, w: 1.18, d: 1.18 },
  ...[-1, 1].flatMap(side => [27, 35, 43, 51, 55.7].map(z => ({ x: side * 19.55, z, w: .4, d: .8 }))),
  { x: 4.8, z: 18.25, w: 1.5, d: 4.45 },
  { x: -6.4, z: 18.25, w: 1.0, d: 2.24 },
] as const;
