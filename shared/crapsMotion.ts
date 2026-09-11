/** A server-authored throw. Rendering never determines the two independent dice. */
export type CrapsMotion = { rollId: string; startedAt: number; dice: [number, number]; previousDice: [number, number] };
export const CRAPS_ROLL_LEAD_MS = 500;
export const CRAPS_ROLL_MS = 4200;
export const CRAPS_GEOMETRY = { width: 5.6, depth: 2.7, feltHeight: 1.04, dieSize: .14, passZ: -.68, dontPassZ: -.88, pointZ: .70 } as const;
export type DieQuaternion = [number, number, number, number];
export type DiePose = { x: number; y: number; z: number; rotation: DieQuaternion };
/** Face normals in the runtime die mesh; opposite sides sum to seven. */
export const DIE_NORMALS: readonly [number, number, number][] = [[0, 1, 0], [0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 0, -1], [0, -1, 0]];
const clamp = (t: number) => Math.max(0, Math.min(1, t));
const smooth = (t: number) => { const u = clamp(t); return u ** 3 * (10 + u * (-15 + 6 * u)); };
function axis(x: number, y: number, z: number, angle: number): DieQuaternion {
  const scale = Math.sin(angle / 2) / Math.hypot(x, y, z); return [x * scale, y * scale, z * scale, Math.cos(angle / 2)];
}
function multiply(a: DieQuaternion, b: DieQuaternion): DieQuaternion {
  const [x, y, z, w] = a, [X, Y, Z, W] = b;
  return [w * X + x * W + y * Z - z * Y, w * Y - x * Z + y * W + z * X, w * Z + x * Y - y * X + z * W, w * W - x * X - y * Y - z * Z];
}
function slerp(a: DieQuaternion, b: DieQuaternion, u: number): DieQuaternion {
  let dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  if (dot < 0) { b = b.map(v => -v) as DieQuaternion; dot = -dot; }
  if (dot > .9995) { const q = a.map((v, i) => v + (b[i] - v) * u); const length = Math.hypot(...q); return q.map(v => v / length) as DieQuaternion; }
  const theta = Math.acos(Math.min(1, dot)), denom = Math.sin(theta);
  return a.map((v, i) => (v * Math.sin((1 - u) * theta) + b[i] * Math.sin(u * theta)) / denom) as DieQuaternion;
}
export function dieRotation(value: number, index = 0): DieQuaternion {
  if (!Number.isInteger(value) || value < 1 || value > 6) throw new Error('Invalid die face');
  const faces: DieQuaternion[] = [[0, 0, 0, 1], axis(1, 0, 0, -Math.PI / 2), axis(0, 0, 1, Math.PI / 2), axis(0, 0, 1, -Math.PI / 2), axis(1, 0, 0, Math.PI / 2), axis(1, 0, 0, Math.PI)];
  return multiply(axis(0, 1, 0, index ? -.41 : .22), faces[value - 1]);
}
/** Conservative support height of the rotated cube; its bevel only reduces this extent. */
export function dieSupportHeight(q: DieQuaternion): number {
  const [x, y, z, w] = q;
  return CRAPS_GEOMETRY.dieSize / 2 * (Math.abs(2 * (x * y + w * z)) + Math.abs(1 - 2 * (x * x + z * z)) + Math.abs(2 * (y * z - w * x)));
}
const endX = [1.45, 1.85], endZ = [-.22, .25];
function resting(value: number, index: number): DiePose {
  return { x: endX[index], y: CRAPS_GEOMETRY.dieSize / 2, z: endZ[index], rotation: dieRotation(value, index) };
}
const bounceTimes = [0, .60, 1.15, 1.62, 2.02, 2.35, 2.62, 2.84, 3.02, 3.16, 3.27, 3.36, 3.43, 3.49, 3.55];
function bounce(t: number): number {
  for (let i = 1; i < bounceTimes.length; i++) if (t < bounceTimes[i]) {
    const duration = bounceTimes[i] - bounceTimes[i - 1], local = t - bounceTimes[i - 1];
    return .5 * 9.81 * local * (duration - local);
  }
  return 0;
}
/** Pure timestamp sampling: spectators, late joins and different frame rates share one throw. */
export function sampleCrapsMotion(motion: CrapsMotion | null | undefined, now: number, reducedMotion = false): [DiePose, DiePose] {
  if (!motion) return [resting(1, 0), resting(1, 1)];
  const t = (now - motion.startedAt) / 1000;
  if (now >= motion.startedAt + CRAPS_ROLL_MS) return [resting(motion.dice[0], 0), resting(motion.dice[1], 1)];
  if (t <= 0 || reducedMotion) return [resting(motion.previousDice[0], 0), resting(motion.previousDice[1], 1)];
  let seed = 2166136261; for (const c of motion.rollId) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
  return [0, 1].map(index => {
    const previous = resting(motion.previousDice[index], index), launch = axis(.7, .35, index ? -.6 : .6, .9);
    const startX = -2.00 + index * .23, startZ = index ? .24 : -.20;
    if (t < .65) {
      const u = smooth(t / .65), rotation = slerp(previous.rotation, launch, u);
      return { x: previous.x + (startX - previous.x) * u, z: previous.z + (startZ - previous.z) * u, y: dieSupportHeight(rotation) + .28 * Math.sin(Math.PI * u), rotation };
    }
    const flight = t - .65, u = clamp(flight / 3.55), wallTime = 1.10 + index * .09;
    // Both dice strike the far cushion, then lose horizontal speed on their return.
    const wallX = 2.40;
    const x = flight < wallTime ? startX + (wallX - startX) * flight / wallTime : wallX + (endX[index] - wallX) * (1 - (1 - clamp((flight - wallTime) / (3.55 - wallTime))) ** 3);
    const drift = ((seed >>> (index * 4)) % 17 - 8) / 80;
    const z = startZ + (endZ[index] - startZ) * smooth(u) + drift * Math.sin(Math.PI * u) ** 2;
    const turns = 4 + (seed >>> (index * 3)) % 3;
    const tumbling = multiply(axis(.7, .35, index ? -.6 : .6, turns * Math.PI * 2 * (1 - (1 - u) ** 2)), launch);
    const rotation = slerp(tumbling, dieRotation(motion.dice[index], index), smooth((u - .70) / .30));
    return { x, z, y: dieSupportHeight(rotation) + bounce(flight), rotation };
  }) as [DiePose, DiePose];
}
