import assert from 'node:assert/strict';
import test from 'node:test';
import { isWalkable, move, district, canHopAt } from '../shared/world.ts';
import { isInShop, clothingItem } from '../shared/catalog.ts';
import { SHOP_LAYOUT, SHOP_BOUNDS, SHOP_WALLS, SHOP_FURNITURE, SHOP_PREVIEW, shopPoint } from '../shared/shopLayout.ts';
import { floorHeight } from '../shared/casinoLayout.ts';

function route(points: number[][]) {
  let position = shopPoint(points[0][0], points[0][1]);
  for (const [x, depth] of points.slice(1)) {
    const target = shopPoint(x, depth);
    for (let step = 0; step < 500 && Math.hypot(position.x - target.x, position.z - target.z) > .06; step++) {
      const dx = target.x - position.x, dz = target.z - position.z, distance = Math.hypot(dx, dz);
      const next = move(position, { x: dx / distance, z: dz / distance, sprint: true }, Math.min(.05, distance / 6.3));
      assert.ok(Math.hypot(next.x-position.x, next.z-position.z) > .001, `Blocked on route to local ${x},${depth} at ${JSON.stringify(position)}`);
      position = { ...position, ...next };
      assert.ok(isWalkable(position.x, position.z));
    }
    assert.ok(Math.hypot(position.x - target.x, position.z - target.z) <= .06);
  }
}

test('both connected departments, checkout and fitting bays are reachable on shared movement', () => {
  const routes = [
    [[0,-2],[0,2.4],[-4,2.4],[-6.1,2.4],[-7.95,2.8],[-7.95,6.2],[-6.1,6.2],[-6.1,7.7],[-4.1,7.7],[-4.1,11.8],[-6.4,11.8]],
    [[0,-2],[0,2.4],[4,2.4],[6.1,2.4],[7.95,2.8],[7.95,6.2],[6.1,6.2],[6.1,7.7],[4.1,7.7],[4.1,11.8],[4.475,11.8],[4.475,14.1]],
    [[0,-2],[0,8.4],[2.35,8.7],[2.35,11.8],[7.925,11.8],[7.925,14.1]],
    [[0,-2],[0,8.4],[-2.35,8.7],[-2.35,11.8],[-6.4,11.8]],
  ];
  for (const path of routes) { route(path); route([...path].reverse()); }
});

test('walls and furniture block walking and sprinting while the old east wall no longer traps visitors', () => {
  for (const solid of [...SHOP_WALLS, ...SHOP_FURNITURE]) assert.equal(isWalkable(solid.x, solid.z), false, solid.name);
  for (const x of [25.5, 26, 26.5, 27, 27.5]) assert.equal(isWalkable(x, -4.35), true, `Old east boundary at ${x}`);
  const start = shopPoint(2.7, 4.2);
  const next = move(start, { x: 0, z: -1, sprint: true }, .1);
  assert.ok(next.z > -4.8, 'Sprint must stop before the department partition');
  for (const p of [[35, -2], [30, 9], [30,-13], [27,10], [-27,0]]) assert.equal(isWalkable(p[0],p[1]), false);
});

test('rear shop purchase and location bounds match the expanded building', () => {
  assert.deepEqual(SHOP_BOUNDS, { front: 18, rear: 34, south: -12, north: 8 });
  assert.equal(isInShop(SHOP_PREVIEW.x, SHOP_PREVIEW.z), true);
  assert.equal(district(SHOP_PREVIEW.x, SHOP_PREVIEW.z), 'Form & Thread');
  assert.equal(floorHeight(29, -2), SHOP_LAYOUT.floor);
  for (const p of [[18,-2], [34,-2], [31,-12], [31,8], [40,-2]]) {
    assert.equal(isInShop(p[0],p[1]), false);
    assert.equal(district(p[0],p[1]), 'Town Square');
  }
  assert.ok(canHopAt(SHOP_PREVIEW.x, SHOP_PREVIEW.z));
});

test('all four displayed outfits use existing catalogue entries in the correct slots', () => {
  for (const mannequin of SHOP_LAYOUT.mannequins) for (const slot of ['top','bottoms','shoes'] as const) assert.equal(clothingItem(mannequin[slot])?.slot, slot);
});
