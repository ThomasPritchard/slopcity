import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Card, CasinoAnchor, CasinoPrivateState } from '../../shared/casino';
import type { PokerView } from '../../shared/poker';
import { POKER_GEOMETRY, POKER_SEAT_OFFSETS, pokerCardPosition } from '../../shared/pokerLayout';
import { floorHeight } from '../../shared/casinoLayout';

type Label = { mesh: Mesh; texture: DynamicTexture; key: string };
/** Fixed mesh pool. Opponents' hole cards arrive only as backs until the server publishes showdown. */
export class PokerTableArt {
 private cards: Mesh[] = [];
 private materials = new Map<string, StandardMaterial>();
 private stacks: Mesh[] = [];
 private bets: Mesh[] = [];
 private labels: Label[] = [];
 private pot: Label;
 private dealer: Label;
 private potChips: Mesh;
 private base: number;
 constructor(private scene: Scene, private anchor: CasinoAnchor) {
  this.base = floorHeight(anchor.x, anchor.z);
  for (let i = 0; i < 17; i++) {
   const card = MeshBuilder.CreatePlane(`poker-live/card-${i}`, { width: .26, height: .38, sideOrientation: Mesh.DOUBLESIDE }, scene);
   card.rotation.x = Math.PI / 2; card.position.y = this.base + POKER_GEOMETRY.cardHeight;
   card.material = this.cardMaterial(null); card.setEnabled(false); this.cards.push(card);
  }
  const chipMaterial = new StandardMaterial('Poker burgundy chip inlays', scene);
  const chipTexture = new DynamicTexture('Poker chip face', { width: 128, height: 128 }, scene, false);
  const ctx = chipTexture.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#994e43'; ctx.fillRect(0, 0, 128, 128); ctx.strokeStyle = '#f2dbac'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(64, 64, 45, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 8; i++) { const angle = i * Math.PI / 4; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(64 + Math.cos(angle) * 55, 64 + Math.sin(angle) * 55); ctx.lineTo(64 + Math.cos(angle) * 66, 64 + Math.sin(angle) * 66); ctx.stroke(); }
  ctx.fillStyle = '#f2dbac'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'italic 50px Georgia'; ctx.fillText('M', 64, 66); chipTexture.update();
  chipMaterial.diffuseTexture = chipTexture; chipMaterial.emissiveColor.set(.22, .22, .22); chipMaterial.specularColor.set(.1, .1, .1);
  const makeChip = (name: string) => { const mesh = MeshBuilder.CreateCylinder(`poker-live/${name}`, { diameter: .14, height: .027, tessellation: 24 }, scene); mesh.material = chipMaterial; mesh.setEnabled(false); return mesh; };
  for (let i = 0; i < 6; i++) {
   this.stacks.push(makeChip(`stack-${i}`)); this.bets.push(makeChip(`bet-${i}`));
   const label = this.label(`seat-${i}`, .86, .24); const p = POKER_SEAT_OFFSETS[i];
   this.position(label.mesh, p.x * .76, p.z * .83, POKER_GEOMETRY.railHeight + .015, p.heading);
   this.labels.push(label);
  }
  this.potChips = makeChip('pot-chips');
  this.pot = this.label('pot', 1.08, .14); this.position(this.pot.mesh, 0, .32, POKER_GEOMETRY.cardHeight);
  this.dealer = this.label('dealer-button', .22, .22); this.write(this.dealer, 'D', '#f4e9cf', '#2c493d'); this.dealer.mesh.setEnabled(false);
  // Asset readiness precedes network admission; every dynamic texture needs its first upload now.
  this.sync(null, { rouletteBets: [] });
 }
 private position(mesh: Mesh, x: number, z: number, y: number, heading = 0) { mesh.position.set(this.anchor.x + x, this.base + y, this.anchor.z + z); mesh.rotation.y = heading; }
 private label(name: string, width: number, height: number): Label {
  const mesh = MeshBuilder.CreateGround(`poker-live/${name}`, { width, height }, this.scene);
  const texture = new DynamicTexture(`Poker ${name}`, { width: 768, height: Math.round(768 * height / width) }, this.scene, false);
  const material = new StandardMaterial(`Poker ${name}`, this.scene); material.diffuseTexture = texture; material.disableLighting = true; material.emissiveColor = Color3.White(); material.backFaceCulling = false;
  mesh.material = material; return { mesh, texture, key: '' };
 }
 private write(label: Label, text: string, background = '#1b382e', foreground = '#f0dfba') {
  const key = `${text}:${background}:${foreground}`; if (key === label.key) return; label.key = key;
  const ctx = label.texture.getContext() as CanvasRenderingContext2D, { width, height } = label.texture.getSize();
  ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); ctx.strokeStyle = '#b29a66'; ctx.lineWidth = 5; ctx.strokeRect(3, 3, width - 6, height - 6);
  ctx.fillStyle = foreground; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${Math.round(height * .48)}px Georgia`; ctx.fillText(text, width / 2, height / 2, width - 24); label.texture.update();
 }
 private cardMaterial(card: Card | null) {
  const key = card ? `${card.rank}-${card.suit}` : 'back', prior = this.materials.get(key); if (prior) return prior;
  const texture = new DynamicTexture(`Poker card ${key}`, { width: 192, height: 288 }, this.scene, false), ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = card ? '#f4eedc' : '#254535'; ctx.fillRect(0, 0, 192, 288); ctx.strokeStyle = '#c2ad78'; ctx.lineWidth = 5; ctx.strokeRect(9, 9, 174, 270); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (card) {
   const glyph = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' }[card.suit]; ctx.fillStyle = card.suit === 'diamonds' || card.suit === 'hearts' ? '#a33f3c' : '#243a2e';
   for (const reverse of [false, true]) { ctx.save(); if (reverse) { ctx.translate(192, 288); ctx.rotate(Math.PI); } ctx.font = 'bold 43px Georgia'; ctx.fillText(card.rank, 41, 39); ctx.font = '28px Georgia'; ctx.fillText(glyph, 41, 79); ctx.restore(); }
   ctx.font = '83px Georgia'; ctx.fillText(glyph, 96, 146);
  } else {
   ctx.strokeStyle = '#9f935e'; ctx.lineWidth = 1; for (let i = -288; i < 192; i += 18) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 288, 288); ctx.stroke(); }
   ctx.fillStyle = '#e5d9aa'; ctx.font = 'italic 88px Georgia'; ctx.fillText('M', 96, 145);
  }
  texture.update(); const material = new StandardMaterial(`Poker card ${key}`, this.scene); material.diffuseTexture = texture; material.specularColor = Color3.Black(); material.emissiveColor.set(.3, .3, .3); this.materials.set(key, material); return material;
 }
 private chip(mesh: Mesh, amount: number, x: number, z: number) {
  mesh.setEnabled(amount > 0); mesh.scaling.y = Math.min(8, Math.max(1, Math.ceil(amount / 50)));
  this.position(mesh, x, z, POKER_GEOMETRY.chipHeight + mesh.scaling.y * .0135);
 }
 sync(table: PokerView | null, privateState: CasinoPrivateState) {
  this.cards.forEach(c => c.setEnabled(false)); this.stacks.forEach(c => c.setEnabled(false)); this.bets.forEach(c => c.setEnabled(false)); this.dealer.mesh.setEnabled(false);
  this.labels.forEach((label, i) => { if (!table?.seats.some(seat => seat.seat === i)) this.write(label, `Seat ${i + 1}`); });
  this.write(this.pot, table?.pot ? `POT  ${table.pot.toLocaleString('en-GB')}` : '5 / 10  ·  HOLD’EM');
  this.chip(this.potChips, table?.phase === 'result' ? 0 : table?.pot ?? 0, .72, .47);
  if (!table) return;
  table.board.forEach((card, index) => { const mesh = this.cards[index]; mesh.material = this.cardMaterial(card); this.position(mesh, (index - 2) * .30, 0, POKER_GEOMETRY.cardHeight); mesh.setEnabled(true); });
  for (const seat of table.seats) {
   const p = POKER_SEAT_OFFSETS[seat.seat], privateHand = privateState.poker;
   const owned = privateHand?.seat === seat.seat && privateHand.handId === table.handId;
   const cards = owned ? privateHand.holeCards : seat.cards;
   cards.forEach((card, index) => {
    if (index > 1) return; const mesh = this.cards[5 + seat.seat * 2 + index], position = pokerCardPosition(seat.seat, index);
    mesh.material = this.cardMaterial(card); this.position(mesh, position.x, position.z, POKER_GEOMETRY.cardHeight, position.heading); mesh.setEnabled(true);
   });
   const centre = pokerCardPosition(seat.seat, 0), tangentX = Math.cos(p.heading), tangentZ = -Math.sin(p.heading);
   this.chip(this.stacks[seat.seat], seat.stack, centre.x + tangentX * .57, centre.z + tangentZ * .57);
   this.chip(this.bets[seat.seat], table.phase === 'result' ? 0 : seat.bet, p.x * .36, p.z * .26);
   const status = seat.leaving ? ' · leaving' : seat.state === 'folded' ? ' · folded' : seat.state === 'all-in' ? ' · all-in' : '';
   this.write(this.labels[seat.seat], `${seat.player.name} · ${seat.stack.toLocaleString('en-GB')}${status}`, table.activeSeat === seat.seat ? '#94713c' : '#1b382e');
   if (seat.seat === table.button) { this.position(this.dealer.mesh, centre.x - tangentX * .29, centre.z - tangentZ * .29, POKER_GEOMETRY.cardHeight + .005, p.heading); this.dealer.mesh.setEnabled(true); }
  }
 }
}
