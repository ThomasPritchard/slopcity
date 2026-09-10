import test from 'node:test';
import assert from 'node:assert/strict';
import { cyclePhase, dayCycleState, DAY_CYCLE_MS, TownDayClock } from '../src/world/dayCycleMath.ts';

test('the town day repeats every 30 minutes, including across the UTC boundary', () => {
  assert.equal(DAY_CYCLE_MS, 1_800_000);
  for (const utc of [-1, 0, 217_893, 1_789_123_456_789]) {
    assert.equal(cyclePhase(utc), cyclePhase(utc + DAY_CYCLE_MS));
    assert.ok(cyclePhase(utc) >= 0 && cyclePhase(utc) < 1);
  }
  assert.ok(Math.abs(cyclePhase(DAY_CYCLE_MS - 1) - 1) < .00001);
});
test('daylight turns lamps off, night turns them on, and dusk/dawn are continuous', () => {
  const noon = dayCycleState(.25), night = dayCycleState(.75);
  assert.equal(noon.lamps, 0); assert.equal(noon.sunIntensity, .7);
  assert.equal(night.lamps, 1); assert.equal(night.sunIntensity, 0);
  assert.ok(night.skyIntensity >= .2 && night.environmentIntensity >= .2, 'night preserves navigable ambient light');
  for (const phase of [0, .5, 1]) {
    const before = dayCycleState(phase - .00001), after = dayCycleState(phase + .00001);
    for (const key of ['lamps', 'sunIntensity', 'moonIntensity', 'skyIntensity', 'environmentIntensity'] as const) assert.ok(Math.abs(before[key] - after[key]) < .001);
  }
});
test('late joiners adopt server time and resume without restarting the cycle', () => {
  const first = new TownDayClock(800_000, 10), late = new TownDayClock(1, 400);
  late.synchronise(first.now(500), 500);
  assert.equal(late.phase(600), first.phase(600));
  assert.equal(first.phase(10 + DAY_CYCLE_MS), first.phase(10));
  assert.equal(first.now(10 + 600_000), 1_400_000, 'background elapsed time is retained');
  const phase = late.phase(600); late.synchronise(NaN, 600); assert.equal(late.phase(600), phase);
});
