import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOUNTAIN } from '../shared/world.ts';
import { FOUNTAIN_WATER as f, fountainJetPoint, JET_FLIGHT_TIME } from '../src/world/fountainMath.ts';

test('fountain streams connect exposed nozzles to the pool inside the existing collision footprint', () => {
  assert.equal(f.x, FOUNTAIN.x); assert.equal(f.z, FOUNTAIN.z);
  assert.ok(f.poolRadius < FOUNTAIN.radius);
  assert.ok(f.nozzleHeight > f.level);
  for (let jet = 0; jet < f.jets; jet++) {
    const start = fountainJetPoint(jet, 0), end = fountainJetPoint(jet, 1);
    assert.ok(Math.abs(Math.hypot(start.x-f.x, start.z-f.z)-f.nozzleRadius)<1e-10);
    assert.equal(start.y, f.nozzleHeight);
    assert.ok(Math.abs(end.y-f.level)<1e-10);
    assert.ok(Math.abs(Math.hypot(end.x-f.x, end.z-f.z)-f.impactRadius)<1e-10);
    for (let sample = 0; sample <= 100; sample++) {
      const p = fountainJetPoint(jet, sample/100);
      assert.ok(p.y >= f.level-1e-10);
      assert.ok(Math.hypot(p.x-f.x, p.z-f.z)+.44 < f.poolRadius, 'stream and impact ripples stay within the bowl');
    }
  }
});

test('fountain jets follow gravity with a finite flight and clear the sculpture plinth', () => {
  assert.ok(JET_FLIGHT_TIME > .7 && JET_FLIGHT_TIME < 1.1);
  const apex = fountainJetPoint(0, f.verticalSpeed/f.gravity/JET_FLIGHT_TIME);
  assert.ok(Math.abs(apex.y-(f.nozzleHeight+f.verticalSpeed**2/(2*f.gravity)))<1e-10);
  assert.ok(apex.y > 1.4 && apex.y < 1.6);
  assert.deepEqual(fountainJetPoint(0,-1), fountainJetPoint(0,0));
  assert.deepEqual(fountainJetPoint(0,2), fountainJetPoint(0,1));
});
