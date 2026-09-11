import test from 'node:test';
import assert from 'node:assert/strict';
import { MINIMAP_BEZEL_INNER, MINIMAP_BEZEL_OUTER, MINIMAP_DISC_RADIUS, MINIMAP_MARK_RADIUS, MINIMAP_PLAN_SHIFT_Y, MINIMAP_VIEW, clampToDial, dialPoint, dialPointFor, headingToMapRotation } from '../src/ui/minimapGeometry.ts';

/** The arrow drawn pointing up in the dial's own coordinates. */
const ARROW_TIP = { x: 0, y: -4.1 };
function rotateOnDial(point: { x: number; y: number }, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return { x: point.x * Math.cos(radians) - point.y * Math.sin(radians), y: point.x * Math.sin(radians) + point.y * Math.cos(radians) };
}

test('the dial is centred on the fountain and keeps the walkable square inside the rim', () => {
  assert.deepEqual(dialPointFor(0, 1), { x: 0, y: 0 });
  assert.ok(MINIMAP_MARK_RADIUS + 4.1 < MINIMAP_DISC_RADIUS, 'a clamped player arrow still points inside the rim');
  assert.ok(MINIMAP_DISC_RADIUS < MINIMAP_VIEW, 'the rim, ticks and chevron fit the dial viewBox');
  assert.equal(MINIMAP_BEZEL_OUTER, MINIMAP_VIEW, 'the bezel reaches the card edge');
  assert.ok(MINIMAP_BEZEL_INNER < MINIMAP_DISC_RADIUS, 'the bezel tucks under the rim without a seam');
  assert.equal(MINIMAP_PLAN_SHIFT_Y, 1);
  // The square's edge midpoints land exactly on the rim, so the walkable town fills the dial edge to edge.
  for (const [x, z] of [[26, 1], [-26, 1], [0, 27], [0, -25]] as const) {
    const midpoint = dialPointFor(x, z);
    assert.ok(Math.abs(Math.hypot(midpoint.x, midpoint.y) - MINIMAP_DISC_RADIUS) < 1e-10, `${x},${z}`);
  }
  for (const [x, z] of [[26, 26], [-26, 26], [26, -26], [-26, -26]] as const) {
    const corner = dialPointFor(x, z);
    assert.ok(Math.hypot(corner.x, corner.y) > MINIMAP_DISC_RADIUS, 'the square corners are cropped, GTA-style');
  }
});

test('dial points run clockwise from north, matching the plan (north up, east right)', () => {
  for (const [degrees, expected] of [[0, { x: 0, y: -26 }], [90, { x: 26, y: 0 }], [180, { x: 0, y: 26 }], [270, { x: -26, y: 0 }]] as const) {
    const point = dialPoint(degrees, MINIMAP_DISC_RADIUS);
    assert.ok(Math.abs(point.x - expected.x) < 1e-10 && Math.abs(point.y - expected.y) < 1e-10, `${degrees}°`);
  }
});

test('heading → SVG rotation points the arrow the way the character walks', () => {
  // scene.ts / server/town.ts record heading = atan2(x, z) for the last movement direction.
  const compass = [
    ['north (+z)', Math.atan2(0, 1), { x: 0, y: -4.1 }],
    ['east (+x)', Math.atan2(1, 0), { x: 4.1, y: 0 }],
    ['south (-z)', Math.atan2(0, -1), { x: 0, y: 4.1 }],
    ['west (-x)', Math.atan2(-1, 0), { x: -4.1, y: 0 }],
    ['north-east', Math.atan2(1, 1), { x: 4.1 / Math.SQRT2, y: -4.1 / Math.SQRT2 }]
  ] as const;
  for (const [label, heading, expected] of compass) {
    const tip = rotateOnDial(ARROW_TIP, headingToMapRotation(heading));
    assert.ok(Math.abs(tip.x - expected.x) < 1e-6 && Math.abs(tip.y - expected.y) < 1e-6, label);
  }
  assert.equal(headingToMapRotation(0), 0);
  assert.equal(headingToMapRotation(Math.PI / 2), 90);
  assert.equal(headingToMapRotation(-Math.PI / 2), 270, 'negative yaw wraps instead of mirroring');
  assert.equal(headingToMapRotation(Math.PI * 2.5), 90, 'yaw wraps past a full turn');
  assert.equal(headingToMapRotation(NaN), 0);
  // The arrow tip is exactly the rim point at the same bearing: one convention, two users.
  for (const degrees of [0, 37, 90, 143, 180, 271, 359]) {
    const tip = rotateOnDial({ x: 0, y: -MINIMAP_DISC_RADIUS }, degrees);
    const tick = dialPoint(degrees, MINIMAP_DISC_RADIUS);
    assert.ok(Math.abs(tip.x - tick.x) < 1e-9 && Math.abs(tip.y - tick.y) < 1e-9);
  }
});

test('marks beyond the rim slide along their own bearing so nobody leaves the dial', () => {
  assert.deepEqual(clampToDial({ x: 3, y: -4 }), { x: 3, y: -4 });
  assert.deepEqual(clampToDial({ x: 0, y: 0 }), { x: 0, y: 0 });
  // The casino sits far north of the square; the marker rides the top rim instead of vanishing.
  const casino = clampToDial(dialPointFor(0, 40));
  assert.ok(Math.abs(casino.x) < 1e-10);
  assert.equal(casino.y, -MINIMAP_MARK_RADIUS);
  const inside = dialPoint(45, 40), edge = clampToDial(inside, MINIMAP_MARK_RADIUS);
  assert.ok(Math.abs(Math.hypot(edge.x, edge.y) - MINIMAP_MARK_RADIUS) < 1e-10);
  assert.ok(Math.abs(edge.x / inside.x - edge.y / inside.y) < 1e-10, 'the bearing survives the clamp');
});
