import type { CreditLeaderboard } from '../../shared/creditLeaderboard';

export const CREDIT_FLAP_DURATION = 420;
export type CreditFlap = { glyph: string; x: number; y: number; width: number; color: string; delay: number };

/** Fixed character positions give each changed letter its own mechanical flap. */
export function creditFlaps(entries: CreditLeaderboard['entries']): CreditFlap[] {
 const cells: CreditFlap[] = [];
 for (let row = 0; row < 10; row++) {
  const entry = entries[row], y = 190 + row * 55;
  const columns = [
   { value: entry ? String(entry.rank).padStart(2, '0') : '', count: 2, x: 65, width: 31, color: '#a7b69f' },
   { value: entry?.name.toUpperCase() ?? '', count: 20, x: 155, width: 37, color: entry?.rank === 1 ? '#f0d797' : '#e3e7d9' },
   { value: entry ? entry.credits.toLocaleString('en-GB').padStart(14) : '', count: 14, x: 995, width: 34, color: '#e0c890' },
  ];
  let slot = 0;
  for (const column of columns) {
   const glyphs = Array.from(column.value);
   for (let i = 0; i < column.count; i++, slot++) cells.push({ glyph: glyphs[i] ?? ' ', x: column.x + i * column.width, y, width: column.width - 3, color: column.color, delay: row * 28 + slot * 10 });
  }
 }
 return cells;
}

export function drawCreditFlap(ctx: CanvasRenderingContext2D, before: CreditFlap, after: CreditFlap, progress: number) {
 const { x, y, width } = after, height = 45, half = height / 2;
 const face = (cell: CreditFlap) => {
  ctx.fillStyle = '#0d211b'; ctx.fillRect(x, y, width, half);
  ctx.fillStyle = '#142a21'; ctx.fillRect(x, y + half, width, half);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = cell.color;
  ctx.font = '600 38px Arial, sans-serif'; ctx.fillText(cell.glyph, x + width / 2, y + half + 1, width - 2);
 };
 const halfFace = (cell: CreditFlap, lower: boolean, scale = 1, shade = 0) => {
  ctx.save();
  ctx.translate(0, y + half); ctx.scale(1, scale); ctx.translate(0, -y - half);
  ctx.beginPath(); ctx.rect(x, y + (lower ? half : 0), width, half); ctx.clip(); face(cell);
  if (shade) { ctx.fillStyle = `rgba(0,0,0,${shade})`; ctx.fillRect(x, y, width, height); }
  ctx.restore();
 };
 if (before.glyph === after.glyph || progress >= 1) face(after);
 else if (progress <= 0) face(before);
 else {
  // The new upper half is revealed as the old leaf closes; the new lower half unfolds after the hinge.
  halfFace(after, false); halfFace(before, true);
  const rotation = Math.cos(Math.PI * progress), shade = .5 * (1 - Math.abs(rotation));
  if (progress < .5) halfFace(before, false, rotation, shade);
  else halfFace(after, true, -rotation, shade);
 }
 ctx.fillStyle = '#020c09cc'; ctx.fillRect(x, y + half - .6, width, 1.2);
 ctx.fillStyle = '#6e775650'; ctx.fillRect(x, y + half - 1.5, 1.5, 3); ctx.fillRect(x + width - 1.5, y + half - 1.5, 1.5, 3);
}
