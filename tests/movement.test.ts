import test from 'node:test';
import assert from 'node:assert/strict';
import { CASINO_ANCHORS, BLACKJACK_SEAT_OFFSETS } from '../shared/casino.ts';
import { floorHeight, inCasino } from '../shared/casinoLayout.ts';
import { isWalkable, move, parseInput, parseProfile, SPEED } from '../shared/world.ts';

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


test('Casino stairs and side ramp connect both levels without permitting high ledge crossings', () => {
 let stairs = { x: 0, z: 21 };
 for (let i = 0; i < 24; i++) stairs = move(stairs, { x: 0, z: 1 }, .05);
 assert.ok(stairs.z > 25); assert.equal(floorHeight(stairs.x, stairs.z), .9);
 for (let i = 0; i < 24; i++) stairs = move(stairs, { x: 0, z: -1 }, .05);
 assert.ok(stairs.z < 22); assert.equal(floorHeight(stairs.x, stairs.z), 0);
 let ramp = { x: 7.3, z: 23.1 };
 for (let i = 0; i < 54; i++) ramp = move(ramp, { x: 1, z: 0 }, .05);
 assert.ok(ramp.x > 18.4); assert.ok(floorHeight(ramp.x, ramp.z) > .85);
 for (let i = 0; i < 14; i++) ramp = move(ramp, { x: 0, z: 1 }, .05);
 assert.ok(ramp.z > 25); assert.equal(floorHeight(ramp.x, ramp.z), .9);
 let ledge = { x: -10, z: 25.3 };
 for (let i = 0; i < 15; i++) ledge = move(ledge, { x: 0, z: -1 }, .05);
 assert.ok(ledge.z > 24.5);
 let rampEdge = { x: 12, z: 23.4 };
 for (let i = 0; i < 15; i++) rampEdge = move(rampEdge, { x: 0, z: 1 }, .05);
 assert.ok(rampEdge.z < 24.1);
});

test('Expanded venue has solid furniture, bounded rear space and an exit for every casino seat', () => {
 assert.ok(inCasino(0, 54)); assert.ok(isWalkable(0, 54));
 assert.equal(isWalkable(21, 40), false); assert.equal(isWalkable(0, 56.4), false);
 assert.equal(isWalkable(4.8, 18.25), false); assert.equal(isWalkable(-6.05, 18.25), false);
 assert.ok(isWalkable(0, 18.25));
 for (const anchor of CASINO_ANCHORS) {
  assert.equal(isWalkable(anchor.x, anchor.z), false, `${anchor.id} solid`);
  if (anchor.game === 'blackjack') for (const seat of BLACKJACK_SEAT_OFFSETS) {
   assert.ok(isWalkable(anchor.x + seat.x, anchor.z + seat.z - .85), `${anchor.id} seat exits into aisle`);
  }
  if (anchor.game === 'slots') assert.ok(isWalkable(anchor.x, anchor.z - 2.1), `${anchor.id} stool exit`);
 }
});

test('Enclosed reception blocks side shortcuts and retains a walkable doorway to the ramp', () => {
 for (const [x, z] of [[-7, 21.5], [7, 20.2], [7, 23], [-6.15, 23], [6.15, 23]]) assert.equal(isWalkable(x, z), false);
 let visitor = { x: 5.8, z: 21.5 };
 for (let i = 0; i < 10; i++) visitor = move(visitor, { x: 1, z: 0 }, .05);
 assert.ok(visitor.x > 7.8, 'Pass through the framed side doorway');
 for (let i = 0; i < 8; i++) visitor = move(visitor, { x: 0, z: 1 }, .05);
 assert.ok(visitor.z > 23, 'Turn onto the ramp beyond the enclosed stair wall');
 for (let i = 0; i < 51; i++) visitor = move(visitor, { x: 1, z: 0 }, .05);
 assert.ok(visitor.x > 18.4);
 for (let i = 0; i < 12; i++) visitor = move(visitor, { x: 0, z: 1 }, .05);
 assert.ok(visitor.z > 25); assert.equal(floorHeight(visitor.x, visitor.z), .9);
});
