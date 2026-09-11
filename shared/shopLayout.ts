import layout from './shop-layout.json' with { type: 'json' };

/** Shared by the maintained Blender builder and both movement peers. Metres, local Z up. */
export const SHOP_LAYOUT = layout;
export const shopPoint = (x: number, depth: number, height = 0) => ({ x: layout.origin.x + depth, y: height, z: layout.origin.z - x });
export const SHOP_BOUNDS = { front: layout.origin.x, rear: layout.origin.x + layout.depth, south: layout.origin.z - layout.width / 2, north: layout.origin.z + layout.width / 2 };
export const inShop = (x: number, z: number, inset = 0) => x > SHOP_BOUNDS.front + inset && x < SHOP_BOUNDS.rear - inset && z > SHOP_BOUNDS.south + inset && z < SHOP_BOUNDS.north - inset;
const box = (local: { name: string; x: number; y: number; w: number; d: number; h: number }) => ({ name: local.name, x: layout.origin.x + local.y, z: layout.origin.z - local.x, w: local.d, d: local.w, h: local.h });
export const SHOP_WALLS = [...layout.shellWalls, ...layout.partitions,
  ...[-1, 1].flatMap(side => [
    ...[5.69, 8.11].map(y => ({ name: `aisle jamb ${side} ${y}`, x: side * 3.2, y, w: .25, d: .18, h: 3.236 })),
    ...[4.66, 7.39].map(x => ({ name: `cross jamb ${side} ${x}`, x: side * x, y: 7, w: .17, d: .24, h: 3.236 })),
  ]),
].map(box);
export const SHOP_FURNITURE = [...layout.furniture, ...layout.rails.map((rail, i) => ({ ...rail, ...layout.railSize, name: `rail ${i + 1}` }))].map(box);
export const SHOP_PREVIEW = shopPoint(layout.preview.x, layout.preview.y, layout.preview.height);
export const SHOP_SIGNS = Object.fromEntries(Object.entries(layout.signs).map(([name, point]) => [name, shopPoint(point.x, point.y, point.height)])) as Record<'fascia' | 'tagline', ReturnType<typeof shopPoint>>;
export const SHOP_OVERHEAD = [
  { name: 'Form & Thread ceiling and beams', x: layout.origin.x + layout.depth / 2, z: layout.origin.z, w: layout.depth, d: layout.width, bottom: 4.58, top: 5.5 },
  { name: 'Form & Thread entrance lintel', x: layout.origin.x, z: layout.origin.z, w: .55, d: 3.7, bottom: 3.9, top: 5.1 },
  ...[-1, 1].flatMap(side => [
    { ...box({ name: `Form & Thread aisle portal ${side}`, x: side * 3.2, y: 6.9, w: .25, d: 2.6, h: .19 }), bottom: 3.046, top: 3.236 },
    { ...box({ name: `Form & Thread cross portal ${side}`, x: side * 6.025, y: 7, w: 2.91, d: .24, h: .19 }), bottom: 3.046, top: 3.236 },
  ]),
  ...layout.fittingCenters.map((x, i) => ({ name: `Form & Thread fitting track ${i + 1}`, x: layout.origin.x + 12.19, z: layout.origin.z - x, w: .04, d: 3.28, bottom: 3.036, top: 3.074 })),
];
