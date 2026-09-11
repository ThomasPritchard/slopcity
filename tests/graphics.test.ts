import test from 'node:test';
import assert from 'node:assert/strict';
import { graphicsPixelRatio, resolveGraphicsQuality } from '../src/settings/graphics';

test('High retains normal render density and Medium retains Performance mode CSS resolution', () => {
  for (const dpr of [.8, 1, 1.5, 2, 3]) {
    assert.equal(graphicsPixelRatio('high', dpr), Math.min(dpr, 1.75));
    assert.equal(graphicsPixelRatio('medium', dpr), 1);
  }
  assert.equal(resolveGraphicsQuality(false), 'high');
  assert.equal(resolveGraphicsQuality(true), 'medium');
});

test('Low can render below CSS resolution while Ultra caps device density without changing the choice', () => {
  assert.equal(graphicsPixelRatio('low', 3), .75);
  assert.equal(graphicsPixelRatio('ultra', 3), 2);
  assert.equal(graphicsPixelRatio('ultra', 1), 1);
  assert.equal(resolveGraphicsQuality('low'), 'low');
  assert.equal(resolveGraphicsQuality('ultra'), 'ultra');
  for (const dpr of [NaN, Infinity, 0, -1]) assert.equal(graphicsPixelRatio('high', dpr), 1);
});
