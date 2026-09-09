import test from 'node:test';
import assert from 'node:assert/strict';
import { move, parseInput, parseProfile, SPEED } from '../shared/world.ts';

test('diagonal input cannot increase server movement speed', () => {
  const start = { x: 0, z: -15 };
  const result = move(start, { x: 1, z: 1 }, .05);
  assert.ok(Math.abs(Math.hypot(result.x - start.x, result.z - start.z) - SPEED * .05) < .00001);
});
test('solid casino facade blocks entry but the doorway permits it', () => {
  let wall = { x: 7, z: 13 }, door = { x: 0, z: 13 };
  for (let i = 0; i < 20; i++) { wall = move(wall, { x: 0, z: 1 }, .05); door = move(door, { x: 0, z: 1 }, .05); }
  assert.ok(wall.z < 13.5); assert.ok(door.z > 16);
});
test('malformed movement packets are rejected and extremes clamped', () => {
  for (const value of [null, {}, { x: NaN, z: 1, seq: 0 }, { x: 1, z: Infinity, seq: 0 }, { x: 0, z: 0, seq: -1 }]) assert.equal(parseInput(value), null);
  assert.deepEqual(parseInput({ x: 100, z: -50, seq: 2 }), { x: 1, z: -1, seq: 2 });
});
test('profile input is bounded and invalid palette indices are replaced', () => {
  assert.deepEqual(parseProfile({ name: '<Tom>\n', shirt: 99, skin: -1 }), { name: 'Tom', shirt: 0, skin: 0 });
});
