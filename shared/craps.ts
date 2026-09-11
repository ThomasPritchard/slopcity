import type { CasinoOccupant, CasinoReadiness } from './casino.ts';
import type { CrapsMotion } from './crapsMotion.ts';
export type CrapsBetKind = 'pass' | 'dont-pass';
export type CrapsBet = { kind: CrapsBetKind; stake: number };
export type CrapsPoint = 4 | 5 | 6 | 8 | 9 | 10;
export type DicePair = [number, number];
export type CrapsResult = { dice: DicePair; total: number; pointBefore: CrapsPoint | null; pointAfter: CrapsPoint | null; resolution: 'point-set' | 'point-continues' | 'pass-wins' | 'dont-pass-wins' | 'bar-twelve' };
export type CrapsView = { readiness?: CasinoReadiness; id: 'craps-1'; game: 'craps'; roundId: string; rollId: string; phase: 'betting' | 'awaiting-roll' | 'rolling' | 'result' | 'paused'; deadline: number; point: CrapsPoint | null; shooter: CasinoOccupant | null; betCount: number; result: CrapsResult | null; history: CrapsResult[]; motion: CrapsMotion | null };
export const CRAPS_BETTING_MS = 20_000;
export const CRAPS_AWAITING_ROLL_MS = 15_000;
export const CRAPS_POINTS: readonly CrapsPoint[] = [4, 5, 6, 8, 9, 10];
export function resolveCraps(dice: DicePair, point: CrapsPoint | null): CrapsResult {
 if (dice.some(d => !Number.isInteger(d) || d < 1 || d > 6)) throw new Error('Invalid dice');
 const total = dice[0] + dice[1];
 const resolution: CrapsResult['resolution'] = point === null ? total === 7 || total === 11 ? 'pass-wins' : total === 2 || total === 3 ? 'dont-pass-wins' : total === 12 ? 'bar-twelve' : 'point-set' : total === point ? 'pass-wins' : total === 7 ? 'dont-pass-wins' : 'point-continues';
 return { dice: [...dice], total, pointBefore: point, pointAfter: resolution === 'point-set' ? total as CrapsPoint : resolution === 'point-continues' ? point : null, resolution };
}
export function crapsReturn(bet: CrapsBet, result: CrapsResult): number {
 if (result.pointAfter !== null) throw new Error('Unresolved craps wager');
 return result.resolution === 'bar-twelve' ? bet.kind === 'dont-pass' ? bet.stake : 0 : (result.resolution === 'pass-wins') === (bet.kind === 'pass') ? bet.stake * 2 : 0;
}
