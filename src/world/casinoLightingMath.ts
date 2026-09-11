/** One four-second marquee phrase, shared by the bulb chase and rising neon bands. */
export const MARQUEE_PERIOD_MS = 4000;

export function marqueeBrightness(timeMs: number, group: number, groups: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  const phase = ((timeMs % MARQUEE_PERIOD_MS) + MARQUEE_PERIOD_MS) % MARQUEE_PERIOD_MS / MARQUEE_PERIOD_MS;
  const crest = Math.max(0, Math.cos(2 * Math.PI * (phase - group / groups)));
  // A smooth travelling highlight retains enough light to read every part of the canopy.
  return .28 + .72 * crest ** 4;
}
