import assert from 'node:assert/strict';
import test from 'node:test';
import { CASINO_ANCHORS, CASINO_INTERACTION_RADIUS } from '../shared/casino.ts';
import { POKER_SEAT_OFFSETS } from '../shared/pokerLayout.ts';
import { inCasino, floorHeight } from '../shared/casinoLayout.ts';
import { isWalkable } from '../shared/world.ts';

test('All six poker chairs remain in reach and release onto a walkable hall exit', () => {
 const anchor = CASINO_ANCHORS.find(a => a.id === 'poker-1')!;
 assert.equal(isWalkable(anchor.x, anchor.z), false, 'Players cannot walk through the table');
 for (const seat of POKER_SEAT_OFFSETS) {
  assert.ok(Math.hypot(seat.x, seat.z) <= CASINO_INTERACTION_RADIUS, 'Seated actions stay in reach');
  assert.ok(inCasino(anchor.x + seat.exitX, anchor.z + seat.exitZ));
  assert.equal(floorHeight(anchor.x + seat.exitX, anchor.z + seat.exitZ), .9);
  assert.ok(isWalkable(anchor.x + seat.exitX, anchor.z + seat.exitZ), 'Cashout places the player clear of furniture');
 }
});
