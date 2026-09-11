import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCraps, crapsReturn, CRAPS_POINTS } from '../shared/craps.ts';
test('All 36 come-out outcomes and each established point resolve line wagers correctly', () => {
 for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
  const sum = a + b, r = resolveCraps([a, b], null);
  const expected = [7, 11].includes(sum) ? 'pass-wins' : [2, 3].includes(sum) ? 'dont-pass-wins' : sum === 12 ? 'bar-twelve' : 'point-set';
  assert.equal(r.resolution, expected);
  if (r.pointAfter === null) {
   assert.equal(crapsReturn({ kind: 'pass', stake: 10 }, r), expected === 'pass-wins' ? 20 : 0);
   assert.equal(crapsReturn({ kind: 'dont-pass', stake: 10 }, r), expected === 'dont-pass-wins' ? 20 : expected === 'bar-twelve' ? 10 : 0);
  } else assert.throws(() => crapsReturn({ kind: 'pass', stake: 10 }, r));
  for (const point of CRAPS_POINTS) {
   const p = resolveCraps([a, b], point);
   assert.equal(p.resolution, sum === point ? 'pass-wins' : sum === 7 ? 'dont-pass-wins' : 'point-continues');
   assert.equal(p.pointAfter, sum === point || sum === 7 ? null : point);
  }
 }
 assert.throws(() => resolveCraps([0, 6], null));
});
