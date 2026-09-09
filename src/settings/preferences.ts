export type Preferences = { low: boolean; motion: 'system' | 'reduced' | 'full'; effects: number; ambience: number };
export const DEFAULT_PREFERENCES: Preferences = { low: false, motion: 'system', effects: .45, ambience: .35 };
export function parsePreferences(value: unknown): Preferences {
  const p = value && typeof value === 'object' ? value as Partial<Preferences> : {};
  const volume = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  return { low: p.low === true, motion: p.motion === 'reduced' || p.motion === 'full' ? p.motion : 'system', effects: volume(p.effects, .45), ambience: volume(p.ambience, .35) };
}
export function loadPreferences(): Preferences {
  try { return parsePreferences(JSON.parse(localStorage.getItem('slop-city-comfort') || '{}')); }
  catch { return { ...DEFAULT_PREFERENCES }; }
}
export function savePreferences(value: Preferences) {
  try { localStorage.setItem('slop-city-comfort', JSON.stringify(value)); } catch { /* Session controls still work when storage is unavailable. */ }
}
