import { CASINO_ANCHORS } from './casino.ts';
export const CAPACITY = 64;
export const SPEED = 4.2;
export const TICK_MS = 50;
export const SHIRTS = ['#687a65', '#dbc8a3', '#354e60', '#b1674e', '#806d87', '#ece8db'];
export const SKINS = ['#f0c4a0', '#d5a079', '#ae7450', '#754a34', '#4e3228'];
export type Profile = { name: string; shirt: number; skin: number };
export type Position = { x: number; z: number };
export type Input = { x: number; z: number; seq: number };
export type Wall = { x: number; z: number; w: number; d: number; h: number; kind: 'wall' | 'planter' };
// World coordinates in metres. Shared collision data is also used to build visible geometry.
export const WALLS: Wall[] = [
  { x: 0, z: 27, w: 54, d: 1, h: 1, kind: 'wall' },
  { x: 0, z: -27, w: 54, d: 1, h: 1, kind: 'wall' },
  { x: -27, z: 0, w: 1, d: 54, h: 1, kind: 'wall' },
  { x: 27, z: 0, w: 1, d: 54, h: 1, kind: 'wall' },
  // Casino at the north side, with a four-metre entrance.
  { x: -9, z: 14, w: 14, d: .5, h: 6, kind: 'wall' },
  { x: 9, z: 14, w: 14, d: .5, h: 6, kind: 'wall' },
  { x: -16, z: 20, w: .5, d: 12, h: 6, kind: 'wall' },
  { x: 16, z: 20, w: .5, d: 12, h: 6, kind: 'wall' },
  { x: 0, z: 26, w: 32, d: .5, h: 6, kind: 'wall' },
  // Clothing store at the east side.
  { x: 18, z: -8, w: .5, d: 8, h: 5, kind: 'wall' },
  { x: 18, z: 4, w: .5, d: 8, h: 5, kind: 'wall' },
  { x: 22, z: -12, w: 8, d: .5, h: 5, kind: 'wall' },
  { x: 22, z: 8, w: 8, d: .5, h: 5, kind: 'wall' },
  { x: 26, z: -2, w: .5, d: 20, h: 5, kind: 'wall' },
  { x: -10, z: 4, w: 4, d: 3, h: .6, kind: 'planter' },
  { x: 10, z: 4, w: 4, d: 3, h: .6, kind: 'planter' },
  { x: -10, z: -11, w: 4, d: 3, h: .6, kind: 'planter' },
  { x: 10, z: -11, w: 4, d: 3, h: .6, kind: 'planter' },
];
const CASINO_SOLIDS = [
  {x:-8,z:20,w:5.1,d:2.3},
  ...CASINO_ANCHORS.filter(anchor=>anchor.game==='slots').map(anchor=>({x:anchor.x,z:anchor.z,w:1.3,d:.9})),
];
export const FOUNTAIN = { x: 0, z: 1, radius: 3.25 };
export function isWalkable(x: number, z: number): boolean {
  const radius = .32;
  if (Math.abs(x) > 26 || Math.abs(z) > 26) return false;
  if (Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) < FOUNTAIN.radius + radius) return false;
  if(CASINO_SOLIDS.some(w=>Math.abs(x-w.x)<w.w/2+radius && Math.abs(z-w.z)<w.d/2+radius))return false;
  // The curved card-table front leaves space for the seated players' feet; the dealer's side stays a dead zone.
  for(const centre of [3,10])if(z>18.9 && z<19.7 && Math.abs(x-centre)<2.55 || z>=19.7 && z<21.2 && Math.abs(x-centre)<2.55 || z<=18.9 && ((x-centre)/2.55)**2+((z-18.9)/1.4)**2<1)return false;
  return !WALLS.some(w => Math.abs(x - w.x) < w.w / 2 + radius && Math.abs(z - w.z) < w.d / 2 + radius);
}
export function move(position: Position, input: Pick<Input, 'x' | 'z'>, seconds: number): Position {
  const length = Math.hypot(input.x, input.z);
  const scale = SPEED * Math.min(.1, Math.max(0, seconds)) / Math.max(1, length);
  const dx = input.x * scale, dz = input.z * scale;
  const x = isWalkable(position.x + dx, position.z) ? position.x + dx : position.x;
  return { x, z: isWalkable(x, position.z + dz) ? position.z + dz : position.z };
}
export function parseInput(value: unknown): Input | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.x !== 'number' || typeof v.z !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.z) || !Number.isSafeInteger(v.seq) || (v.seq as number) < 0) return null;
  return { x: Math.max(-1, Math.min(1, v.x)), z: Math.max(-1, Math.min(1, v.z)), seq: v.seq as number };
}
export function parseProfile(value: unknown): Profile {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Profile>;
  const name = typeof v.name === 'string' ? v.name.normalize('NFKC').replace(/[\p{C}<>]/gu, '').trim().slice(0, 20) : '';
  return { name: name || 'New neighbour', shirt: Number.isInteger(v.shirt) && v.shirt! >= 0 && v.shirt! < SHIRTS.length ? v.shirt! : 0, skin: Number.isInteger(v.skin) && v.skin! >= 0 && v.skin! < SKINS.length ? v.skin! : 0 };
}
export function district(x: number, z: number): string {
  return z > 14 && Math.abs(x) < 16 ? 'The Meridian Casino' : x > 18 && z > -12 && z < 8 ? 'Form & Thread' : 'Town Square';
}
