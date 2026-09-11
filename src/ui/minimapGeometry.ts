/* Circular minimap dial geometry — pure numbers, no DOM.
   Conventions pinned here (see the test): the plan is north-up, an SVG point's y grows downwards,
   map y is -z (TownMapSvg), and a heading is the avatar yaw `Math.atan2(x, z)` around +Y that
   server/town.ts records while moving and scene.ts applies as `root.rotation.y`. */

/** Map units visible from the centre of the dial: the walkable square (±26) reads edge to edge. */
export const MINIMAP_DISC_RADIUS = 26;
/** Marks stop short of the rim (the player arrow reaches ~4 units ahead) so off-square players stay on the dial. */
export const MINIMAP_MARK_RADIUS = 21;
/** The dark bezel band runs from just under the rim out to the card edge, where the ticks and the
    lime north chevron sit. */
export const MINIMAP_BEZEL_INNER = MINIMAP_DISC_RADIUS - .2;
export const MINIMAP_BEZEL_OUTER = 32;
/** Half-extent of the square dial viewBox: the disc plus the room its rim, ticks and north chevron need. */
export const MINIMAP_VIEW = MINIMAP_BEZEL_OUTER;
/** The plan's fountain sits at map (0, -1); shifting it to the origin centres the dial on the fountain. */
export const MINIMAP_PLAN_SHIFT_Y = 1;

/** A dial-relative point at `degrees` clockwise from north (0° is up, 90° is east/right). */
export function dialPoint(degrees: number, radius: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  return { x: Math.sin(radians) * radius, y: -Math.cos(radians) * radius };
}

/** World position → dial position (map x is world x, map y is -z, then the fountain shift). */
export function dialPointFor(x: number, z: number): { x: number; y: number } {
  return { x, y: -z + MINIMAP_PLAN_SHIFT_Y };
}

/** Avatar yaw in radians → SVG `rotate()` degrees for an arrow drawn pointing up.
    SVG rotates clockwise on screen and map north is up, so a yaw of 0 (walking +z) is 0° and
    walking +x (east) is 90°: the arrow tip lands exactly on `dialPoint(degrees, length)`. */
export function headingToMapRotation(heading: number): number {
  if (!Number.isFinite(heading)) return 0;
  const degrees = (heading * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

/** Keep a mark on the dial: a position outside `radius` slides to the rim along its own bearing. */
export function clampToDial(point: { x: number; y: number }, radius: number = MINIMAP_MARK_RADIUS): { x: number; y: number } {
  const distance = Math.hypot(point.x, point.y);
  if (distance <= radius || distance === 0) return point;
  const scale = radius / distance;
  return { x: point.x * scale, y: point.y * scale };
}
