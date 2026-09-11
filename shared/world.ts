import { CASINO_ANCHORS } from './casino.ts';
import { POKER_GEOMETRY } from './pokerLayout.ts';
import { CRAPS_GEOMETRY } from './crapsMotion.ts';
import { CASINO_WALLS, CASINO_FURNITURE, floorHeight, inCasino } from './casinoLayout.ts';
import { HOP_HEIGHT, PLAYER_HEIGHT, OVERHEAD_SOLIDS, SPRINT_MULTIPLIER } from './mobility.ts';
import { BENCHES } from './social.ts';
import { SHOP_WALLS, SHOP_FURNITURE, inShop } from './shopLayout.ts';
import { MEMORIES_BOARD } from './memories.ts';
import { CINEMA_WALLS, inCinema } from './cinemaLayout.ts';
export const CAPACITY = 64;
export const SPEED = 4.2;
export const TICK_MS = 50;
export const SHIRTS = ['#687a65', '#dbc8a3', '#354e60', '#b1674e', '#806d87', '#ece8db'];
export const SKINS = ['#f0c4a0', '#d5a079', '#ae7450', '#754a34', '#4e3228'];
export type Profile = { name: string; shirt: number; skin: number };
export type Position = { x: number; z: number };
export type Input = { x: number; z: number; seq: number; sprint?: boolean };
export type Wall = { x: number; z: number; w: number; d: number; h: number; kind: 'wall' | 'planter' | 'casino' | 'shop' | 'noticeboard' | 'cinema' };
// Visual beds and authoritative movement use the same footprints, including the arrival trees.
export const PLANTING_BEDS = [
  { x: -10, z: 4, w: 4, d: 3, h: .6, asset: 'planter', treeScale: .9, rotation: .15 },
  { x: 10, z: 4, w: 4, d: 3, h: .6, asset: 'planter', treeScale: .92, rotation: 1.7 },
  { x: -10, z: -11, w: 4, d: 3, h: .6, asset: 'planter', treeScale: .9, rotation: 3.0 },
  { x: 10, z: -11, w: 4, d: 3, h: .6, asset: 'planter', treeScale: .94, rotation: 4.4 },
  ...[-22, -17, 17, 23].map((x, i) => ({ x, z: -20, w: 2.6, d: 2.6, h: .6, asset: 'entrance-planter', treeScale: 1.04, rotation: i * 1.6 })),
] as const;
// World coordinates in metres. Shared collision data is also used to build visible geometry.
export const WALLS: Wall[] = [
  { x: MEMORIES_BOARD.x, z: MEMORIES_BOARD.z, w: MEMORIES_BOARD.width, d: MEMORIES_BOARD.depth, h: MEMORIES_BOARD.height, kind: 'noticeboard' },
  { x: -23.5, z: 27, w: 7, d: 1, h: 1, kind: 'wall' },
  { x: 23.5, z: 27, w: 7, d: 1, h: 1, kind: 'wall' },
  { x: 0, z: -27, w: 54, d: 1, h: 1, kind: 'wall' },
  { x: -27, z: 0, w: 1, d: 54, h: 1, kind: 'wall' },
  { x: 27, z: 17.5, w: 1, d: 19, h: 1, kind: 'wall' },
  { x: 27, z: -19.5, w: 1, d: 15, h: 1, kind: 'wall' },
  ...CASINO_WALLS.map(w => ({ ...w, kind: 'casino' as const })),
  ...SHOP_WALLS.map(w => ({ ...w, kind: 'shop' as const })),
  ...CINEMA_WALLS.map(w => ({ ...w, kind: 'cinema' as const })),
  ...PLANTING_BEDS.map(({ x, z, w, d, h }) => ({ x, z, w, d, h, kind: 'planter' as const })),
];
const CASINO_SOLIDS = [
  ...CASINO_FURNITURE,
  ...CASINO_ANCHORS.filter(anchor=>anchor.game==='poker').map(anchor=>({x:anchor.x,z:anchor.z,w:POKER_GEOMETRY.width,d:POKER_GEOMETRY.depth})),
  ...CASINO_ANCHORS.filter(anchor=>anchor.game==='roulette').map(anchor=>({x:anchor.x,z:anchor.z,w:5.1,d:2.3})),
  ...CASINO_ANCHORS.filter(anchor=>anchor.game==='slots').map(anchor=>({x:anchor.x,z:anchor.z,w:1.3,d:.9})),
  ...CASINO_ANCHORS.filter(anchor=>anchor.game==='craps').map(anchor=>({x:anchor.x,z:anchor.z,w:CRAPS_GEOMETRY.width,d:CRAPS_GEOMETRY.depth})),
];
const BLACKJACK_ANCHORS = CASINO_ANCHORS.filter(a => a.game === 'blackjack');
export const FOUNTAIN = { x: 0, z: 1, radius: 3.25 };
export function isWalkable(x: number, z: number): boolean {
  const radius = .32;
  if ((Math.abs(x) > 26 || Math.abs(z) > 26) && !inCasino(x, z) && !inShop(x, z)) return false;
  if (Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) < FOUNTAIN.radius + radius) return false;
  if(CASINO_SOLIDS.some(w=>Math.abs(x-w.x)<w.w/2+radius && Math.abs(z-w.z)<w.d/2+radius))return false;
  if (SHOP_FURNITURE.some(w => Math.abs(x-w.x) < w.w/2+radius && Math.abs(z-w.z) < w.d/2+radius)) return false;
  // The curved card-table front leaves space for the seated players' feet; the dealer's side stays a dead zone.
  for (const anchor of BLACKJACK_ANCHORS) {
    const dx = x - anchor.x, dz = z - anchor.z;
    if ((dz > -.1 && dz < 2.2 && Math.abs(dx) < 2.55) || (dz <= -.1 && (dx / 2.55) ** 2 + ((dz + .1) / 1.4) ** 2 < 1)) return false;
  }
  return !WALLS.some(w => Math.abs(x - w.x) < w.w / 2 + radius && Math.abs(z - w.z) < w.d / 2 + radius);
}
export function hasBodyClearance(x: number, z: number, extraHeight = 0): boolean {
  const floor = floorHeight(x, z);
  return OVERHEAD_SOLIDS.every(bound => Math.abs(x - bound.x) >= bound.w / 2 + .32 || Math.abs(z - bound.z) >= bound.d / 2 + .32 || floor >= bound.top || floor + PLAYER_HEIGHT + extraHeight + .05 <= bound.bottom);
}
export function clearOfBenches(x: number, z: number): boolean {
  return BENCHES.every(bench => {
    const dx = x - bench.x, dz = z - bench.z;
    const across = Math.cos(bench.heading) * dx - Math.sin(bench.heading) * dz;
    const depth = Math.sin(bench.heading) * dx + Math.cos(bench.heading) * dz;
    return Math.abs(across) >= 1.175 + .32 || Math.abs(depth) >= .4 + .32;
  });
}
export const canHopAt = (x: number, z: number) => isWalkable(x, z) && clearOfBenches(x, z) && hasBodyClearance(x, z, HOP_HEIGHT);
export function move(position: Position, input: Pick<Input, 'x' | 'z' | 'sprint'>, seconds: number, airborne = false): Position {
  const length = Math.hypot(input.x, input.z);
  const scale = SPEED * (input.sprint ? SPRINT_MULTIPLIER : 1) * Math.min(.1, Math.max(0, seconds)) / Math.max(1, length);
  const dx = input.x * scale, dz = input.z * scale;
  const canStep = (ax: number, az: number, bx: number, bz: number) => isWalkable(bx, bz) && (!airborne || canHopAt(bx, bz)) && Math.abs(floorHeight(ax, az) - floorHeight(bx, bz)) <= .181;
  // Sweep short steps so sprint and delayed frames cannot skip a wall or stair riser.
  // Preserve recovery from an existing small overlap (for example an old seat/entry
  // anchor) when the endpoint is clear; substeps inside the overlap would trap it.
  const steps = isWalkable(position.x, position.z) ? Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / .12)) : 1;
  let { x, z } = position;
  for (let step = 0; step < steps; step++) {
    if (canStep(x, z, x + dx / steps, z)) x += dx / steps;
    if (canStep(x, z, x, z + dz / steps)) z += dz / steps;
  }
  return { x, z };
}
export function parseInput(value: unknown): Input | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.x !== 'number' || typeof v.z !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.z) || !Number.isSafeInteger(v.seq) || (v.seq as number) < 0) return null;
  if (v.sprint !== undefined && typeof v.sprint !== 'boolean') return null;
  return { x: Math.max(-1, Math.min(1, v.x)), z: Math.max(-1, Math.min(1, v.z)), seq: v.seq as number, ...(v.sprint !== undefined ? { sprint: v.sprint as boolean } : {}) };
}
export function parseProfile(value: unknown): Profile {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Profile>;
  const name = typeof v.name === 'string' ? v.name.normalize('NFKC').replace(/[\p{C}<>]/gu, '').trim().slice(0, 20) : '';
  return { name: name || 'New neighbour', shirt: Number.isInteger(v.shirt) && v.shirt! >= 0 && v.shirt! < SHIRTS.length ? v.shirt! : 0, skin: Number.isInteger(v.skin) && v.skin! >= 0 && v.skin! < SKINS.length ? v.skin! : 0 };
}
export function district(x: number, z: number): string {
  return inCasino(x, z) ? 'The Meridian Casino' : inShop(x, z) ? 'Form & Thread' : inCinema(x,z) ? 'The Bridge Picture House' : 'Town Square';
}
