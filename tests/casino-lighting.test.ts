import test from 'node:test';
import assert from 'node:assert/strict';
import { MARQUEE_PERIOD_MS, marqueeBrightness } from '../src/world/casinoLightingMath.ts';

test('Marquee highlights travel through every group on a repeating shared clock', () => {
  for (const groups of [3, 8]) for (let group = 0; group < groups; group++) {
    const time = MARQUEE_PERIOD_MS * group / groups;
    const brightness = Array.from({ length: groups }, (_, index) => marqueeBrightness(time, index, groups, false));
    assert.equal(brightness.indexOf(Math.max(...brightness)), group);
    assert.ok(brightness.every(value => value >= .28 && value <= 1));
    for (let index = 0; index < groups; index++) assert.ok(Math.abs(brightness[index] - marqueeBrightness(time + MARQUEE_PERIOD_MS, index, groups, false)) < 1e-12);
  }
});

test('Reduced motion keeps every marquee group steadily illuminated', () => {
  for (const time of [-1000, 0, 1500, 4500, 987654321]) for (let group = 0; group < 8; group++) {
    assert.equal(marqueeBrightness(time, group, 8, true), 1);
  }
});
