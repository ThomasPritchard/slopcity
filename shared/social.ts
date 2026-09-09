import type { Position } from './world.ts';

// Authored bench: 2.35m wide, seat top .5075m, back at local z=-.29.
// Babylon imports the Blender -Y facing direction as +Z. Heading zero faces +Z.
export const BENCHES = [
  { id: 'fountain-west', x: -5.8, z: 1, heading: -Math.PI / 2 },
  { id: 'fountain-east', x: 5.8, z: 1, heading: Math.PI / 2 },
  { id: 'south-west', x: -10, z: -7, heading: Math.PI },
  { id: 'south-east', x: 10, z: -7, heading: Math.PI },
] as const;
export type Seat = Position & { id: string; benchId: string; heading: number; exit: Position };
export const SIT_REACH = 2;
export const SEATS: readonly Seat[] = BENCHES.flatMap(bench => [-.52, .52].map((offset, index) => {
  const x = bench.x + Math.cos(bench.heading) * offset;
  const z = bench.z - Math.sin(bench.heading) * offset;
  return {
    id: `${bench.id}-${index + 1}`, benchId: bench.id, x, z, heading: bench.heading,
    exit: { x: x + Math.sin(bench.heading) * 1.05, z: z + Math.cos(bench.heading) * 1.05 },
  };
}));
