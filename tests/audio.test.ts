import test from 'node:test';
import assert from 'node:assert/strict';
import { TownAudio } from '../src/audio/TownAudio';
import type { CasinoState, SlotsView } from '../shared/casino';

// Exercise authoritative event gating without pretending synthesis was heard.
function harness() {
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const events = { addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { ...events, hasFocus: () => true, hidden: false } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
  const audio = new TownAudio();
  let sounds = 0;
  const internals = audio as unknown as { audible: () => boolean; burst: () => void };
  internals.audible = () => true;
  internals.burst = () => { sounds++; };
  audio.setActive(true);
  return { audio, count: () => sounds, cleanup: () => {
    audio.dispose();
    if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else Reflect.deleteProperty(globalThis, 'window');
  } };
}
const state = (time: number, phase: SlotsView['phase'], round = 'one'): CasinoState => ({ serverTime: time, tables: [{
  id: 'slots-1', game: 'slots', roundId: round, phase, deadline: 0, player: null, reels: [], stake: 10, returned: null,
}] });

test('slots sound only new authoritative transitions, never baseline, duplicates, stale snapshots or rejoin', () => {
  const h = harness();
  try {
    h.audio.casino(state(1, 'idle'), 'slots-1');
    assert.equal(h.count(), 0);
    h.audio.casino(state(2, 'spinning'), 'slots-1');
    h.audio.casino(state(2, 'spinning'), 'slots-1');
    h.audio.casino(state(1, 'idle'), 'slots-1');
    assert.equal(h.count(), 1);
    h.audio.casino(state(3, 'result'), 'slots-1');
    assert.equal(h.count(), 2);
    h.audio.casino(state(4, 'idle'), null);
    h.audio.casino(state(5, 'spinning', 'two'), 'slots-1');
    assert.equal(h.count(), 2);
    h.audio.setActive(false); h.audio.setActive(true);
    h.audio.casino(state(6, 'result', 'two'), 'slots-1');
    assert.equal(h.count(), 2);
  } finally { h.cleanup(); }
});

test('chip receipts require accepted wagers and deduplicate requests', () => {
  const h = harness();
  try {
    h.audio.casino(state(1, 'idle'), 'slots-1');
    h.audio.receipt({ requestId: 'a', ok: false, message: 'Rejected' });
    h.audio.receipt({ requestId: 'b', ok: true, message: 'Joined' });
    const receipt = { requestId: 'c', ok: true, message: 'Accepted', wagerId: 'wager' };
    h.audio.receipt(receipt); h.audio.receipt(receipt);
    assert.equal(h.count(), 1);
  } finally { h.cleanup(); }
});
