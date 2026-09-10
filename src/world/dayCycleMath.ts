export const DAY_CYCLE_MS = 30 * 60 * 1000;
export const DAYLIGHT_PHASE = .25;
export function cyclePhase(milliseconds: number): number {
  return ((milliseconds % DAY_CYCLE_MS) + DAY_CYCLE_MS) % DAY_CYCLE_MS / DAY_CYCLE_MS;
}
const smooth = (low: number, high: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};
/** Phase 0 = dawn, .25 = noon, .5 = dusk, .75 = midnight. */
export function dayCycleState(phase: number) {
  const angle = phase * Math.PI * 2, elevation = Math.sin(angle);
  const daylight = smooth(-.20, .26, elevation);
  const sun = smooth(-.02, .32, elevation);
  const twilight = (1 - smooth(.05, .62, Math.abs(elevation))) * daylight;
  const lamps = 1 - smooth(-.12, .27, elevation);
  return { phase, elevation, daylight, sun, twilight, lamps,
    sunIntensity: .7 * sun,
    moonIntensity: .1 * smooth(.06, .30, -elevation),
    skyIntensity: .22 + .23 * daylight,
    environmentIntensity: .25 + .45 * daylight,
  };
}

/** Server UTC anchors a monotonic clock so clock changes and late joiners do not restart the day. */
export class TownDayClock {
  private anchorUtc: number;
  private anchorMonotonic: number;
  constructor(utc = Date.now(), monotonic = performance.now()) { this.anchorUtc = utc; this.anchorMonotonic = monotonic; }
  synchronise(serverUtc: number, monotonic = performance.now()) {
    if (!Number.isFinite(serverUtc)) return;
    this.anchorUtc = serverUtc; this.anchorMonotonic = monotonic;
  }
  now(monotonic = performance.now()) { return this.anchorUtc + monotonic - this.anchorMonotonic; }
  phase(monotonic = performance.now()) { return cyclePhase(this.now(monotonic)); }
}
