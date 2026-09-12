import test from 'node:test';
import assert from 'node:assert/strict';
import { chatTableFor, parseChatCommand } from '../shared/chat.ts';
import { CASINO_ANCHORS } from '../shared/casino.ts';

test('chat destinations fail closed and strip forged sender metadata', () => {
  assert.deepEqual(parseChatCommand('hello'), { channel: 'town', body: 'hello' });
  const toProfileId = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(parseChatCommand({ channel: 'whisper', toProfileId, body: 'hello', name: 'forged', sentAt: 1 }), { channel: 'whisper', toProfileId, body: 'hello' });
  for (const value of [null, [], 4, { body: 'secret' }, { channel: 'whisper', body: 'secret' }, { channel: 'whisper', toProfileId: 'unknown', body: 'secret' }, { channel: 'table', tableId: 'roulette-900', body: 'secret' }, { channel: 'global', body: 'secret' }]) assert.equal(parseChatCommand(value), null);
});

test('table chat requires a real table and current authoritative proximity or occupancy', () => {
  for (const table of CASINO_ANCHORS) {
    const player = { x: table.x, z: table.z - 2, seatId: '' };
    assert.equal(chatTableFor(player), null, 'nearby bystanders do not subscribe');
    assert.equal(chatTableFor(player, table.id), table.id);
    assert.equal(chatTableFor({ ...player, z: table.z - 4 }, table.id), null, 'leaving reach revokes membership');
    assert.equal(chatTableFor({ ...player, seatId: 'casino:poker-1:2' }, table.id), 'poker-1', 'occupied seat owns the destination');
  }
  assert.equal(chatTableFor({ x: 0, z: 0, seatId: 'casino:unknown:0' }), null);
});
