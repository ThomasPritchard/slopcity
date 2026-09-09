import test from 'node:test';
import assert from 'node:assert/strict';
import { SEATS, SIT_REACH } from '../shared/social.ts';
import { isWalkable } from '../shared/world.ts';
import { requestSit, requestStand, type SeatedCitizen } from '../server/seating.ts';
const seat = SEATS[0]!;
const citizen = (): SeatedCitizen => ({ seatId: '', ...seat.exit, heading: 0 });

test('serialized simultaneous claims have one winner; departing citizens release occupancy', () => {
  const first = citizen(), second = citizen(), players = new Set([first, second]);
  Object.assign(first, requestSit(first, seat.id, players));
  assert.equal(first.seatId, seat.id);
  assert.equal(requestSit(second, seat.id, players), null);
  assert.deepEqual(requestSit(first, seat.id, players), first);
  players.delete(first);
  assert.equal(requestSit(second, seat.id, players)?.seatId, seat.id);
});
test('unknown, malformed, nonfinite and unreachable sit requests fail', () => {
  const player = citizen();
  for (const id of [null, {}, 1, '', 'missing']) assert.equal(requestSit(player, id, [player]), null);
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.equal(requestSit({ ...player, x: invalid }, seat.id, []), null);
    assert.equal(requestSit({ ...player, z: invalid }, seat.id, []), null);
  }
  assert.equal(requestSit({ ...player, x: seat.x + SIT_REACH + .01, z: seat.z }, seat.id, []), null);
  assert.ok(requestSit({ ...player, x: seat.x + SIT_REACH, z: seat.z }, seat.id, []));
  assert.equal(requestSit({ ...player, seatId: SEATS[1]!.id }, seat.id, []), null);
});
test('every standing exit is walkable, clears occupancy and standing is idempotent', () => {
  assert.equal(new Set(SEATS.map(s => s.id)).size, SEATS.length);
  for (const candidate of SEATS) {
    const player = { seatId: candidate.id, x: candidate.x, z: candidate.z, heading: candidate.heading };
    const standing = requestStand(player)!;
    assert.ok(isWalkable(standing.x, standing.z));
    assert.deepEqual(standing, { seatId: '', ...candidate.exit, heading: candidate.heading });
    assert.deepEqual(requestStand(standing), standing);
    Object.assign(player, standing);
    assert.ok(requestSit(citizen(), seat.id, [player]));
  }
  assert.equal(requestStand({ ...citizen(), seatId: 'missing' }), null);
});
