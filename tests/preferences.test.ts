import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePreferences, loadPreferences, savePreferences, DEFAULT_PREFERENCES } from '../src/settings/preferences';

test('comfort preferences default to High and tolerate corrupt values', () => {
  for (const value of [null, undefined, false, 'medium', [], {}]) {
    assert.deepEqual(parsePreferences(value), DEFAULT_PREFERENCES);
  }
  assert.deepEqual(parsePreferences({ graphics: 'automatic', low: 'true', motion: 'unknown', effects: NaN, ambience: Infinity }), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences({ graphics: 'low', motion: 'reduced', effects: 2, ambience: -1 }), { graphics: 'low', motion: 'reduced', effects: 1, ambience: 0 });
});

test('legacy Performance mode migrates to Medium while preserving comfort controls', () => {
  assert.deepEqual(parsePreferences({ low: true, motion: 'reduced', effects: .2, ambience: .7 }), { graphics: 'medium', motion: 'reduced', effects: .2, ambience: .7 });
  assert.deepEqual(parsePreferences({ low: false }), DEFAULT_PREFERENCES);
  for (const graphics of [null, false, 1, '', 'HIGH', 'automatic', {}, []]) {
    assert.equal(parsePreferences({ graphics, low: true }).graphics, 'medium');
    assert.equal(parsePreferences({ graphics, low: false }).graphics, 'high');
    assert.equal(parsePreferences({ graphics }).graphics, 'high');
  }
});

test('explicit graphics presets take precedence over legacy Performance mode', () => {
  for (const graphics of ['low', 'medium', 'high', 'ultra'] as const) {
    for (const low of [false, true]) {
      assert.deepEqual(parsePreferences({ graphics, low, motion: 'full', effects: .65, ambience: .1 }), { graphics, motion: 'full', effects: .65, ambience: .1 });
    }
  }
});

test('all graphics presets round-trip in the existing browser storage key', t => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const saved = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) },
  });
  t.after(() => {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });

  assert.deepEqual(loadPreferences(), DEFAULT_PREFERENCES);
  saved.set('slop-city-comfort', JSON.stringify({ low: true, motion: 'reduced', effects: 0, ambience: .5 }));
  const migrated = loadPreferences();
  assert.deepEqual(migrated, { graphics: 'medium', motion: 'reduced', effects: 0, ambience: .5 });
  savePreferences(migrated);
  assert.deepEqual(JSON.parse(saved.get('slop-city-comfort')!), migrated);

  for (const graphics of ['low', 'medium', 'high', 'ultra'] as const) {
    const preferences = { graphics, motion: 'full' as const, effects: .75, ambience: .25 };
    savePreferences(preferences);
    assert.deepEqual(loadPreferences(), preferences);
    assert.deepEqual(JSON.parse(saved.get('slop-city-comfort')!), preferences);
  }
  assert.deepEqual([...saved.keys()], ['slop-city-comfort']);
  saved.set('slop-city-comfort', '{invalid JSON');
  assert.deepEqual(loadPreferences(), DEFAULT_PREFERENCES);
});
