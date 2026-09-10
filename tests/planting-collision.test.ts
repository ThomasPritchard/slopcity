import test from 'node:test';
import assert from 'node:assert/strict';
import { isWalkable, move, PLANTING_BEDS, WALLS } from '../shared/world.ts';

test('all eight visible beds have the same authoritative collision footprint', () => {
  assert.equal(PLANTING_BEDS.length, 8);
  for (const bed of PLANTING_BEDS) {
    assert.ok(WALLS.some(w => w.kind === 'planter' && w.x === bed.x && w.z === bed.z && w.w === bed.w && w.d === bed.d));
    assert.equal(isWalkable(bed.x, bed.z), false);
  }
});
test('arrival beds block walking through soil while the central arrival route remains open', () => {
  for (const bed of PLANTING_BEDS.filter(b => b.z === -20)) {
    let p = { x: bed.x, z: bed.z - bed.d / 2 - 1 };
    for (let i = 0; i < 40; i++) p = move(p, { x: 0, z: 1 }, .05);
    assert.ok(p.z < bed.z - bed.d / 2 - .31);
    assert.equal(isWalkable(bed.x + bed.w / 2 + .4, bed.z), true);
  }
  for (let z = -25; z <= -15; z += .5) assert.equal(isWalkable(0, z), true);
});
