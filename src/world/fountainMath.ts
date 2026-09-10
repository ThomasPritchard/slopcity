/** Presentation geometry shared by the stream, spray and ripple effects. Metres / seconds. */
export const FOUNTAIN_WATER = {
  x: 0, z: 1, level: .44, poolRadius: 2.79,
  nozzleRadius: .92, nozzleHeight: .56, impactRadius: 2.3,
  gravity: 9.81, verticalSpeed: 4.2, jets: 8,
} as const;
const f = FOUNTAIN_WATER;
export const JET_FLIGHT_TIME = (f.verticalSpeed + Math.sqrt(f.verticalSpeed ** 2 + 2 * f.gravity * (f.nozzleHeight - f.level))) / f.gravity;
export const JET_RADIAL_SPEED = (f.impactRadius - f.nozzleRadius) / JET_FLIGHT_TIME;

export function fountainJetPoint(jet: number, fraction: number) {
  const t = Math.max(0, Math.min(1, fraction)) * JET_FLIGHT_TIME;
  const angle = jet / f.jets * Math.PI * 2;
  const radius = f.nozzleRadius + JET_RADIAL_SPEED * t;
  return { x: f.x + Math.cos(angle) * radius,
    y: f.nozzleHeight + f.verticalSpeed * t - .5 * f.gravity * t * t,
    z: f.z + Math.sin(angle) * radius };
}
