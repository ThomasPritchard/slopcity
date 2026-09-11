import test from 'node:test';
import assert from 'node:assert/strict';
import { CRAPS_ROLL_MS, CRAPS_GEOMETRY, sampleCrapsMotion, dieSupportHeight, type CrapsMotion } from '../shared/crapsMotion.ts';
import { CASINO_ANCHORS, CASINO_INTERACTION_RADIUS } from '../shared/casino.ts';
import { isWalkable, move } from '../shared/world.ts';

test('Craps throws preserve pose through scheduled launch/settle and clear the felt at every rotation', () => {
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
    const motion: CrapsMotion = { rollId: `throw-${a}-${b}`, startedAt: 2000, dice: [a, b], previousDice: [b, a] };
    for (let now = 1950; now <= 6500; now += 10) for (const pose of sampleCrapsMotion(motion, now)) {
      assert.ok(pose.y >= dieSupportHeight(pose.rotation) - 1e-10, 'Dice never penetrate the felt');
      assert.ok(Math.abs(pose.x) <= 2.40 && Math.abs(pose.z) < .45, 'Dice remain in the clear rolling lane');
      assert.ok(Math.abs(Math.hypot(...pose.rotation) - 1) < 1e-10);
    }
    for (const boundary of [2000, 2650, 2000 + CRAPS_ROLL_MS]) {
      const before = sampleCrapsMotion(motion, boundary - .01), after = sampleCrapsMotion(motion, boundary + .01);
      for (let i = 0; i < 2; i++) {
        assert.ok(Math.hypot(before[i].x - after[i].x, before[i].y - after[i].y, before[i].z - after[i].z) < .001);
        assert.ok(Math.abs(before[i].rotation.reduce((sum, v, j) => sum + v * after[i].rotation[j], 0)) > .99999);
      }
    }
  }
});

test('Shared dice are frame-independent and reduced motion changes only on completion', () => {
  const motion: CrapsMotion = { rollId: 'shared-dice', startedAt: 1000, dice: [4, 6], previousDice: [2, 3] };
  for (const end of [1200, 2300, 4650, 5200, 9500]) {
    for (const fps of [20, 30, 60, 144]) {
      const snapshot = structuredClone(motion);
      for (let now = 1000; now < end; now += 1000 / fps) sampleCrapsMotion(snapshot, now);
      assert.deepEqual(sampleCrapsMotion(snapshot, end), sampleCrapsMotion(motion, end));
    }
  }
  assert.deepEqual(sampleCrapsMotion(motion, 1100, true), sampleCrapsMotion(motion, 5199, true));
  assert.deepEqual(sampleCrapsMotion(motion, 5200, true), sampleCrapsMotion(motion, 5200));
  const next = { ...motion, rollId: 'next', startedAt: 9000, previousDice: motion.dice, dice: [1, 2] as [number, number] };
  assert.deepEqual(sampleCrapsMotion(motion, 9000), sampleCrapsMotion(next, 9000));
});

test('Craps has reachable standing positions and its physical table blocks movement', () => {
  const table = CASINO_ANCHORS.find(a => a.game === 'craps')!;
  assert.equal(isWalkable(table.x, table.z), false);
  for (const x of [-1.8, 0, 1.8]) for (const z of [-1.9, 1.9]) {
    assert.ok(isWalkable(table.x + x, table.z + z));
    assert.ok(Math.hypot(x, z) < CASINO_INTERACTION_RADIUS);
  }
  let pos = { x: table.x, z: table.z - 2.4 };
  for (let i = 0; i < 30; i++) pos = move(pos, { x: 0, z: 1 }, .05);
  assert.ok(pos.z <= table.z - CRAPS_GEOMETRY.depth / 2 - .32);
});
