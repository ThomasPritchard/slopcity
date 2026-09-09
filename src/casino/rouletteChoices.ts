import { ROULETTE_RED_NUMBERS, type RouletteBetKind } from '../../shared/casino';

export const rouletteKinds: readonly { kind: RouletteBetKind; label: string }[] = [
  { kind: 'straight', label: 'Single number' }, { kind: 'split', label: 'Split · two numbers' },
  { kind: 'street', label: 'Street · three numbers' }, { kind: 'trio', label: 'Trio · includes zero' },
  { kind: 'corner', label: 'Corner · four numbers' }, { kind: 'first-four', label: 'First four · 0–3' },
  { kind: 'six-line', label: 'Six line · two streets' }, { kind: 'red', label: 'Red' },
  { kind: 'black', label: 'Black' }, { kind: 'odd', label: 'Odd' }, { kind: 'even', label: 'Even' },
  { kind: 'low', label: 'Low · 1–18' }, { kind: 'high', label: 'High · 19–36' },
  { kind: 'dozen', label: 'Dozen · twelve numbers' }, { kind: 'column', label: 'Column · twelve numbers' },
];

export function rouletteChoices(kind: RouletteBetKind): number[][] {
  const numbers = Array.from({ length: 36 }, (_, index) => index + 1);
  switch (kind) {
    case 'straight': return Array.from({ length: 37 }, (_, index) => [index]);
    case 'split': return [[0, 1], [0, 2], [0, 3], ...numbers.filter(n => n % 3 !== 0).map(n => [n, n + 1]), ...numbers.filter(n => n <= 33).map(n => [n, n + 3])];
    case 'street': return Array.from({ length: 12 }, (_, row) => [row * 3 + 1, row * 3 + 2, row * 3 + 3]);
    case 'trio': return [[0, 1, 2], [0, 2, 3]];
    case 'corner': return numbers.filter(n => n <= 32 && n % 3 !== 0).map(n => [n, n + 1, n + 3, n + 4]);
    case 'first-four': return [[0, 1, 2, 3]];
    case 'six-line': return Array.from({ length: 11 }, (_, row) => Array.from({ length: 6 }, (_, index) => row * 3 + index + 1));
    case 'red': return [[...ROULETTE_RED_NUMBERS]];
    case 'black': return [numbers.filter(n => !isRed(n))];
    case 'odd': return [numbers.filter(n => n % 2 === 1)];
    case 'even': return [numbers.filter(n => n % 2 === 0)];
    case 'low': return [numbers.slice(0, 18)];
    case 'high': return [numbers.slice(18)];
    case 'dozen': return [numbers.slice(0, 12), numbers.slice(12, 24), numbers.slice(24)];
    case 'column': return [1, 2, 0].map(remainder => numbers.filter(n => n % 3 === remainder));
  }
}

export function isRed(number: number) { return (ROULETTE_RED_NUMBERS as readonly number[]).includes(number); }

export function rouletteCoverageLabel(kind: RouletteBetKind, numbers: readonly number[]) {
  if (kind === 'dozen') return `${numbers[0]}–${numbers[numbers.length - 1]}`;
  if (kind === 'column') return `${numbers[0]} · ${numbers[1]} · ${numbers[2]} … ${numbers[numbers.length - 1]}`;
  if (numbers.length > 6) return rouletteKinds.find(option => option.kind === kind)?.label ?? kind;
  return numbers.join(' / ');
}
