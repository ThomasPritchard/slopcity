/** Server-authored motion, sampled by every viewer at the same server time. */
export type RouletteMotion = {
  roundId: string;
  startedAt: number;
  wheelStart: number;
  ballStart: number;
  /** Supplied only after the wager settlement commits. */
  landingAt: number | null;
  number: number | null;
};

export const ROULETTE_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26] as const;
export const ROULETTE_LANDING_LEAD_MS = 500;
export const ROULETTE_LANDING_MS = 4200;
export const ROULETTE_GEOMETRY = {
  ballRadius: .03, trackRadius: .88, trackHeight: .10,
  pocketRadius: .585, pocketFloor: .004, pocketHeight: .034,
  dividerTop: .045, dividerWidth: .008,
} as const;

const TAU = Math.PI * 2;
const LAUNCH = .8, CAPTURE = 3.6, COAST = 7.2;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const u = clamp(n); return u * u * (3 - 2 * u); };
const smoother = (n: number) => { const u = clamp(n); return u ** 3 * (10 + u * (-15 + 6 * u)); };

function character(roundId: string) {
  let hash = 2166136261;
  for (const c of roundId) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return { wheel: .9 + (hash >>> 0) % 101 / 100 * .15, launch: 7.5 + (hash >>> 8) % 101 / 100 * 1.2 };
}

function wheelTravel(t: number, speed: number) {
  if (t < LAUNCH) return speed * (t ** 3 / LAUNCH ** 2 - .5 * t ** 4 / LAUNCH ** 3);
  return speed * (t - LAUNCH / 2);
}

function ballTravel(t: number, speed: number) {
  if (t < LAUNCH) return { angle: wheelTravel(t, speed), speed: speed * smooth(t / LAUNCH) };
  const s = t - LAUNCH, drag = Math.exp(-.65 * s);
  return { angle: speed * LAUNCH / 2 + 4.5 * s + (speed - 4.5) / .65 * (1 - drag), speed: 4.5 + (speed - 4.5) * drag };
}

export function roulettePocketAngle(number: number) {
  const index = ROULETTE_ORDER.indexOf(number as typeof ROULETTE_ORDER[number]);
  if (index < 0) throw new Error('Invalid roulette pocket');
  return (index + .5) / 37 * TAU;
}

export type RoulettePose = { wheelAngle: number; ballAngle: number; radius: number; height: number; landed: boolean };

/** Gravity and diminishing restitution within the captured pocket; no penetration below its bed. */
function pocketBounce(seconds: number): number {
  const floor = ROULETTE_GEOMETRY.pocketHeight, release = .09, gravity = 9.81;
  const fall = Math.sqrt(2 * (release - floor) / gravity);
  if (seconds < fall) return release - .5 * gravity * seconds ** 2;
  let time = seconds - fall, velocity = gravity * fall * .34;
  for (let bounce = 0; bounce < 5; bounce++) {
    const duration = 2 * velocity / gravity;
    if (time < duration) return floor + velocity * time - .5 * gravity * time ** 2;
    time -= duration; velocity *= .34;
  }
  return floor;
}

/**
 * A constrained landing simulation, not a client physics engine or outcome RNG.
 * No accumulated frame delta, local randomness or packet-arrival start time.
 * Angles are unwrapped: the ball counter-rotates, then joins its moving pocket.
 */
export function sampleRouletteMotion(motion: RouletteMotion | null | undefined, now: number, restingNumber = 0): RoulettePose {
  const g = ROULETTE_GEOMETRY;
  // Babylon's glTF handedness root is part of the asset transform. With our π
  // instance rotation, Blender (cos a, sin a) maps to town (cos a, sin a).
  // A pocket's world angle is therefore π - wheelAngle + pocketAngle.
  if (!motion) return { wheelAngle: Math.PI, ballAngle: roulettePocketAngle(restingNumber), radius: g.pocketRadius, height: g.pocketHeight, landed: true };
  const speeds = character(motion.roundId), t = Math.max(0, (now - motion.startedAt) / 1000);
  const landing = motion.landingAt === null ? null : Math.max(0, (motion.landingAt - motion.startedAt) / 1000);
  if (landing === null || motion.number === null || t < landing) {
    const u = smooth(t / LAUNCH);
    return {
      wheelAngle: motion.wheelStart + wheelTravel(t, speeds.wheel),
      ballAngle: motion.ballStart + ballTravel(t, speeds.launch).angle,
      radius: g.pocketRadius + (g.trackRadius - g.pocketRadius) * u,
      // The launch lifts clear of the raised number deck before reaching the race.
      height: g.pocketHeight + (g.trackHeight - g.pocketHeight) * u + .10 * smooth(t / .16) * (1 - smoother(t / LAUNCH)),
      landed: false,
    };
  }
  const elapsed = t - landing, coast = clamp(elapsed / COAST);
  const wheelAtRelease = motion.wheelStart + wheelTravel(landing, speeds.wheel);
  const wheelAngle = wheelAtRelease + speeds.wheel * COAST / 4 * (1 - (1 - coast) ** 4);
  const start = ballTravel(landing, speeds.launch), pocket = roulettePocketAngle(motion.number);
  const relativeStart = motion.ballStart + start.angle + wheelAtRelease - pocket - Math.PI;
  const relativeSpeed = start.speed + speeds.wheel;
  // Choose whole forward revolutions around the average deceleration distance.
  // CAPTURE * relativeSpeed >= 6π keeps this Hermite curve monotone and decelerating
  // for every possible pocket, with matched velocity at release and capture.
  const relativeEnd = Math.round((relativeStart + .5 * CAPTURE * relativeSpeed) / TAU) * TAU;
  const distance = relativeEnd - relativeStart;
  if (elapsed < CAPTURE) {
    const u = elapsed / CAPTURE;
    const relative = relativeStart + smooth(u) * distance + (u ** 3 - 2 * u * u + u) * CAPTURE * relativeSpeed;
    const descent = smoother((elapsed - 2.4) / 1.2);
    const outerDrift = smoother(elapsed / 2.4);
    const radius = elapsed < 2.4 ? g.trackRadius + (.80 - g.trackRadius) * outerDrift : .80 + (g.pocketRadius - .80) * descent;
    // Clearance over the deck/frets, with two small deflections as the ball descends.
    const hop = .035 * Math.sin(Math.PI * descent) ** 2 * (.35 + .65 * Math.sin(2 * Math.PI * descent) ** 2);
    return { wheelAngle, ballAngle: relative - wheelAngle + pocket + Math.PI, radius, height: g.trackHeight - .01 * descent + hop, landed: false };
  }
  const settle = elapsed - CAPTURE, u = clamp(settle / .6);
  const wobble = .012 * Math.sin(4 * Math.PI * u) * Math.sin(Math.PI * u) ** 2 * (1 - u);
  return { wheelAngle, ballAngle: relativeEnd - wheelAngle + pocket + Math.PI + wobble, radius: g.pocketRadius, height: pocketBounce(settle), landed: now >= motion.landingAt! + ROULETTE_LANDING_MS };
}

export function startRouletteMotion(roundId: string, startedAt: number, previous: RouletteMotion | null): RouletteMotion {
  const pose = sampleRouletteMotion(previous, startedAt);
  return { roundId, startedAt, wheelStart: pose.wheelAngle % TAU, ballStart: pose.ballAngle % TAU, landingAt: null, number: null };
}
