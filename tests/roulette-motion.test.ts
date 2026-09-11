import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleRouletteMotion, startRouletteMotion, roulettePocketAngle, ROULETTE_GEOMETRY as g, ROULETTE_ORDER, ROULETTE_LANDING_MS, type RouletteMotion } from '../shared/rouletteMotion.ts';

const motion = (number: number, seed = 'shared-round'): RouletteMotion => ({ ...startRouletteMotion(seed, 1000, null), landingAt: 6500, number });
const point = (p: ReturnType<typeof sampleRouletteMotion>) => [Math.cos(p.ballAngle) * p.radius, p.height, Math.sin(p.ballAngle) * p.radius];
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));

test('Every number captures the ball at the centre of one recessed pocket, then carries it with the rotor', () => {
  for (const seed of ['island-one', 'island-two', 'reconnected', 'another-round']) for (const number of ROULETTE_ORDER) {
    const spin = motion(number, seed);
    for (const time of [spin.landingAt! + ROULETTE_LANDING_MS, 15000, 60000]) {
      const pose = sampleRouletteMotion(spin, time);
      const error = Math.atan2(Math.sin(pose.ballAngle + pose.wheelAngle - roulettePocketAngle(number) - Math.PI), Math.cos(pose.ballAngle + pose.wheelAngle - roulettePocketAngle(number) - Math.PI));
      assert.ok(Math.abs(error) < 1e-10, `${seed}/${number} pocket centre`);
      assert.equal(pose.radius, g.pocketRadius); assert.equal(pose.height, g.pocketHeight); assert.equal(pose.landed, true);
      assert.ok(g.pocketRadius * Math.sin(Math.PI / 37) - g.dividerWidth / 2 > g.ballRadius, 'Sphere clears both dividers');
    }
  }
});

test('Settlement publication cannot snap the ball, and release/capture preserve position and velocity', () => {
  for (const number of ROULETTE_ORDER) {
    const spin = motion(number), secret = { ...spin, landingAt: null, number: null };
    for (const time of [6000, 6200, 6499]) assert.deepEqual(sampleRouletteMotion(spin, time), sampleRouletteMotion(secret, time));
    for (const boundary of [1800, 6500, 10100, 10700]) {
      const before = point(sampleRouletteMotion(spin, boundary - 1)), at = point(sampleRouletteMotion(spin, boundary)), after = point(sampleRouletteMotion(spin, boundary + 1));
      assert.ok(distance(before, after) < .017, `Continuous position at ${boundary}/${number}`);
      const v1 = at.map((v, i) => (v - before[i]) * 1000), v2 = after.map((v, i) => (v - at[i]) * 1000);
      assert.ok(distance(v1, v2) < .09, `Continuous velocity at ${boundary}/${number}: ${distance(v1, v2)}`);
    }
  }
});

test('Landing decelerates forward relative to the wheel instead of taking a shortcut backwards', () => {
  for (const seed of ['a', 'b', 'c', 'd', 'long-delayed-spin']) for (const number of ROULETTE_ORDER) {
    const spin = motion(number, seed);
    if (seed === 'long-delayed-spin') spin.landingAt! += 60000;
    let lastVelocity = Infinity;
    for (let t = spin.landingAt!; t < spin.landingAt! + 3590; t += 10) {
      const a = sampleRouletteMotion(spin, t), b = sampleRouletteMotion(spin, t + 10);
      const velocity = (b.ballAngle + b.wheelAngle - a.ballAngle - a.wheelAngle) * 100;
      assert.ok(velocity >= -1e-9 && velocity <= lastVelocity + 1e-8, `${seed}/${number} forward deceleration`);
      assert.ok(a.height >= g.pocketHeight && a.radius >= g.pocketRadius && a.radius <= g.trackRadius);
      lastVelocity = velocity;
    }
  }
});

test('Different frame rates, repeated snapshots and reconnects sample the identical shared trajectory', () => {
  const spin = motion(24);
  for (const end of [2000, 6000, 7200, 10150, 10600, 20000]) {
    const reference = sampleRouletteMotion(spin, end);
    for (const fps of [20, 30, 60, 144]) {
      const snapshot = JSON.parse(JSON.stringify(spin));
      for (let t = 1000; t < end; t += 1000 / fps) sampleRouletteMotion(snapshot, t);
      assert.deepEqual(sampleRouletteMotion(snapshot, end), reference);
    }
    assert.deepEqual(sampleRouletteMotion(JSON.parse(JSON.stringify(spin)), end), reference, 'Late join needs no prior frames');
  }
  const next = startRouletteMotion('next-round', 40000, spin);
  assert.ok(distance(point(sampleRouletteMotion(spin, 40000)), point(sampleRouletteMotion(next, 40000))) < 1e-12, 'Starting another round preserves the resting ball position');
});
