import test from 'node:test';
import assert from 'node:assert/strict';
import { isWalkable, move, canHopAt, type Position } from '../shared/world.ts';
import { MEMORIES_BOARD } from '../shared/memories.ts';

test('The memories board stops walking and hopping while preserving its approach and the main casino route', () => {
 const { x, z } = MEMORIES_BOARD;
 assert.equal(isWalkable(x,z), false); assert.equal(canHopAt(x,z), false);
 assert.ok(isWalkable(x,z-2) && isWalkable(x,z+2));
 let position: Position = { x, z: z-2 };
 for (let i=0;i<12;i++) position = move(position,{ x:0,z:1,sprint:true },.1);
 assert.ok(position.z < z-.4 && position.z > z-.7, 'Sprint is stopped in front of the display');
 assert.ok(isWalkable(-4.7,z), 'Square-to-casino walking route remains clear');
});
