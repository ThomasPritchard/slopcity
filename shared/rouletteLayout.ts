import type { RouletteBet } from './casino.ts';

/** Local felt coordinates in the authored roulette-table asset (build_casino.py). */
export function rouletteNumberPosition(number: number) {
  return number === 0 ? { x: .95, z: .74 }
    : { x: -.05 + (number - 1) % 6 * .4, z: .525 - Math.floor((number - 1) / 6) * .15 };
}

export function rouletteChipPosition(bet: RouletteBet) {
  const outside = ['low', 'even', 'red', 'black', 'odd', 'high'].indexOf(bet.kind);
  if (outside >= 0) return { x: -.05 + outside * .4, z: -.525 };
  if (bet.kind === 'dozen') return { x: .15 + Math.floor((Math.min(...bet.numbers) - 1) / 12) * .8, z: -.375 };
  if (bet.kind === 'column') return { x: 2.29, z: [.44, .17, -.10][Math.min(...bet.numbers) - 1] };
  const points = bet.numbers.map(rouletteNumberPosition);
  return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length };
}
