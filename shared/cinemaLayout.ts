import layout from './cinema-layout.json' with { type: 'json' };

/** Metres, X east and Z north. The Blender builder reads this same layout. */
export const CINEMA_LAYOUT = layout;
export function inCinema(x: number, z: number) {
  return x >= -26 && x <= -12 && z >= -10.5 && z <= 6.5;
}
export function cinemaFloorHeight(x: number, z: number): number {
  const { court, ramp, tiers } = CINEMA_LAYOUT;
  if (x >= ramp.minX && x <= ramp.maxX && z >= ramp.minZ && z <= ramp.maxZ) {
    return ramp.height * (ramp.maxX - x) / (ramp.maxX - ramp.minX);
  }
  if (x < court.minX || x > court.maxX || z < court.minZ || z > court.maxZ) return 0;
  return tiers.find(tier => x < tier.maxX)?.height ?? tiers[tiers.length - 1].height;
}
export const CINEMA_BENCHES = CINEMA_LAYOUT.tiers.flatMap((tier, row) => CINEMA_LAYOUT.benchZ.map((z, index) => ({
  id: `cinema-${row + 1}-${index + 1}`, x: tier.benchX, z,
  heading: -Math.PI / 2 - (z - CINEMA_LAYOUT.centre.z) * .035,
})));
export const CINEMA_WALLS = [CINEMA_LAYOUT.surround, ...CINEMA_LAYOUT.beds, CINEMA_LAYOUT.notice];
