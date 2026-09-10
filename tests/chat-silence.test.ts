import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatDiscipline, silenceForStrikes } from '../server/moderation.ts';

// Injectable wall clock so the ledger is exercised without real waits.
const clock = (start = 1_000) => { let now = start; return { now: () => now, advance: (ms: number) => { now += ms; } }; };

test('the first two offences warn and the third silences for a minute', () => {
  const time = clock(), discipline = new ChatDiscipline(time.now);
  assert.deepEqual(discipline.recordOffence('guest-1'), { silencedMs: 0 });
  assert.deepEqual(discipline.recordOffence('guest-1'), { silencedMs: 0 });
  assert.equal(discipline.silenceRemaining('guest-1'), 0);
  assert.deepEqual(discipline.recordOffence('guest-2'), { silencedMs: 0 });
  assert.deepEqual(discipline.recordOffence('guest-1'), { silencedMs: 60_000 });
  assert.equal(discipline.silenceRemaining('guest-1'), 60_000);
  time.advance(59_999);
  assert.equal(discipline.silenceRemaining('guest-1'), 1);
  time.advance(1);
  assert.equal(discipline.silenceRemaining('guest-1'), 0);
  assert.equal(discipline.silenceRemaining('guest-2'), 0);
});

test('silence doubles from a minute and never exceeds fifteen minutes', () => {
  const time = clock(), discipline = new ChatDiscipline(time.now);
  const expected = [0, 0, 60_000, 120_000, 240_000, 480_000, 900_000];
  for (const silencedMs of expected) {
    assert.deepEqual(discipline.recordOffence('guest-1'), { silencedMs });
    time.advance(silencedMs + 1); // Serve each silence before the next offence.
  }
  // The schedule stays capped beyond the reachable ladder.
  assert.equal(silenceForStrikes(8), 900_000);
  assert.equal(silenceForStrikes(12), 900_000);
});

test('an active silence absorbs further offences without escalating', () => {
  const time = clock(), discipline = new ChatDiscipline(time.now);
  discipline.recordOffence('guest-1');
  discipline.recordOffence('guest-1');
  assert.deepEqual(discipline.recordOffence('guest-1'), { silencedMs: 60_000 });
  time.advance(30_000);
  assert.deepEqual(discipline.recordOffence('guest-1'), { silencedMs: 30_000 }); // Reports the remainder, adds no strike.
  time.advance(30_000);
  assert.deepEqual(discipline.recordOffence('guest-1'), { silencedMs: 120_000 }); // The ladder resumes at the fourth strike.
});

test('strikes stop counting after ten quiet minutes', () => {
  const time = clock(), discipline = new ChatDiscipline(time.now);
  discipline.recordOffence('guest-1');
  discipline.recordOffence('guest-1');
  assert.deepEqual(discipline.recordOffence('guest-1'), { silencedMs: 60_000 });
  time.advance(60_001);
  assert.deepEqual(discipline.recordOffence('guest-1'), { silencedMs: 120_000 }); // Offences separated by a served silence still escalate.
  time.advance(120_001);
  time.advance(600_000);
  assert.deepEqual(discipline.recordOffence('guest-1'), { silencedMs: 0 }); // The quiet run has expired.
  assert.deepEqual(discipline.recordOffence('guest-1'), { silencedMs: 0 });
  assert.deepEqual(discipline.recordOffence('guest-1'), { silencedMs: 60_000 });
});

test('flood and repeat windows are per session and roll over', () => {
  const time = clock(), discipline = new ChatDiscipline(time.now);
  for (let message = 0; message < 5; message++) assert.equal(discipline.flooding('session-a'), false);
  assert.equal(discipline.flooding('session-a'), true);
  assert.equal(discipline.flooding('session-b'), false);
  time.advance(10_000);
  assert.equal(discipline.flooding('session-a'), false);
  assert.equal(discipline.isRepeat('session-a', 'hello'), false);
  assert.equal(discipline.isRepeat('session-a', 'hello'), true);
  assert.equal(discipline.isRepeat('session-b', 'hello'), false);
  assert.equal(discipline.isRepeat('session-a', 'hello there'), false);
  time.advance(10_000);
  assert.equal(discipline.isRepeat('session-a', 'hello there'), false);
});

test('dispose clears session windows but keeps the offence ledger', () => {
  const time = clock(), discipline = new ChatDiscipline(time.now);
  for (let message = 0; message < 5; message++) assert.equal(discipline.flooding('session-a'), false);
  assert.equal(discipline.flooding('session-a'), true);
  assert.equal(discipline.isRepeat('session-a', 'hello'), false);
  assert.equal(discipline.isRepeat('session-a', 'hello'), true);
  discipline.recordOffence('guest-1');
  discipline.recordOffence('guest-1');
  discipline.dispose('session-a');
  assert.equal(discipline.flooding('session-a'), false);
  assert.equal(discipline.isRepeat('session-a', 'hello'), false);
  assert.deepEqual(discipline.recordOffence('guest-1'), { silencedMs: 60_000 }); // The ledger survives the disconnect.
});
