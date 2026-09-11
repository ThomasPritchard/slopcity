export const GRAPHICS_QUALITIES = ['low', 'medium', 'high', 'ultra'] as const;
export type GraphicsQuality = typeof GRAPHICS_QUALITIES[number];
export const GRAPHICS_LABELS: Record<GraphicsQuality, string> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };
export const GRAPHICS_DESCRIPTIONS: Record<GraphicsQuality, string> = {
  low: 'Lighter rendering, simpler shadows and fewer decorative effects.',
  medium: 'Balanced detail with lighter shadows and reflections.',
  high: 'The full town appearance. Default quality.',
  ultra: 'Sharper rendering and shadows, with more detail at a distance.',
};
export function isGraphicsQuality(value: unknown): value is GraphicsQuality {
  return typeof value === 'string' && GRAPHICS_QUALITIES.some(quality => quality === value);
}

// Older renderer fixtures use the former Performance mode boolean.
export function resolveGraphicsQuality(value: GraphicsQuality | boolean): GraphicsQuality {
  return typeof value === 'boolean' ? value ? 'medium' : 'high' : value;
}

type GraphicsBudget = {
  pixelRatio: number;
  shadowSize: number;
  shadowRefresh: number;
  shadowFilter: 'low' | 'high';
  shadowNeighbours: number;
  shadowDistance: number;
  characterDetailDistance: number;
  crowdDetailDistance: number;
  movingAnimationDistance: number;
  idleAnimationDistance: number;
  waterSize: number;
  waterRefresh: number;
  waterNormalRefresh: number;
  sprayDensity: number;
  grassDetail: boolean;
  seedDetail: boolean;
  glow: boolean;
};

/** Explicit, browser-saved choices. High preserves the former normal settings;
 * Medium preserves Performance mode. No device or frame-rate auto downgrade. */
export const GRAPHICS_PRESETS: Record<GraphicsQuality, Readonly<GraphicsBudget>> = {
  low: {
    pixelRatio: .75, shadowSize: 512, shadowRefresh: 2, shadowFilter: 'low',
    shadowNeighbours: 2, shadowDistance: 8,
    characterDetailDistance: 5, crowdDetailDistance: 3, movingAnimationDistance: 24, idleAnimationDistance: 5,
    waterSize: 256, waterRefresh: 4, waterNormalRefresh: 4, sprayDensity: .2,
    grassDetail: false, seedDetail: false, glow: false,
  },
  medium: {
    pixelRatio: 1, shadowSize: 1024, shadowRefresh: 2, shadowFilter: 'low',
    shadowNeighbours: 4, shadowDistance: 10,
    characterDetailDistance: 7, crowdDetailDistance: 4, movingAnimationDistance: 30, idleAnimationDistance: 6,
    waterSize: 512, waterRefresh: 3, waterNormalRefresh: 2, sprayDensity: .45,
    grassDetail: false, seedDetail: true, glow: false,
  },
  high: {
    pixelRatio: 1.75, shadowSize: 2048, shadowRefresh: 1, shadowFilter: 'high',
    shadowNeighbours: 8, shadowDistance: 15,
    characterDetailDistance: 10, crowdDetailDistance: 6, movingAnimationDistance: 45, idleAnimationDistance: 12,
    waterSize: 512, waterRefresh: 1, waterNormalRefresh: 1, sprayDensity: 1,
    grassDetail: true, seedDetail: true, glow: true,
  },
  ultra: {
    pixelRatio: 2, shadowSize: 4096, shadowRefresh: 1, shadowFilter: 'high',
    shadowNeighbours: 12, shadowDistance: 20,
    characterDetailDistance: 14, crowdDetailDistance: 9, movingAnimationDistance: 55, idleAnimationDistance: 16,
    waterSize: 512, waterRefresh: 1, waterNormalRefresh: 1, sprayDensity: 1,
    grassDetail: true, seedDetail: true, glow: true,
  },
};

export function graphicsPixelRatio(quality: GraphicsQuality, devicePixelRatio: number): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  // Preserve Medium's former CSS resolution, even when a browser reports DPR < 1.
  return quality === 'medium' ? 1 : Math.min(ratio, GRAPHICS_PRESETS[quality].pixelRatio);
}
