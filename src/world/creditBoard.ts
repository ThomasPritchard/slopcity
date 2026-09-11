import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CREDIT_BOARD, type CreditLeaderboard } from '../../shared/creditLeaderboard';
import { CREDIT_FLAP_DURATION, creditFlaps, drawCreditFlap } from './creditBoardFlaps';

/** One persistent screen texture; uploads only when its displayed standings change. */
export class CreditBoard {
 readonly root: TransformNode;
 private texture: DynamicTexture;
 private lastKey = '';
 private snapshot: CreditLeaderboard | null = null;
 private unavailable = false;
 private reducedMotion = false;
 private cells = creditFlaps([]);
 private previous = this.cells;
 private elapsed = 0;
 private duration = 0;
 private lastPaint = 0;
 constructor(scene: Scene) {
  const board = CREDIT_BOARD;
  this.root = new TransformNode('casino-credit-board', scene);
  this.root.position.set(board.x, board.y, board.z); this.root.rotation.y = Math.PI / 2;
  const brass = new StandardMaterial('Credit board brushed brass', scene);
  brass.diffuseColor = Color3.FromHexString('#b9a16c'); brass.specularColor.set(.25, .22, .15);
  const frame = MeshBuilder.CreateBox('Credit leaderboard brass frame', { width: board.width + .12, height: board.height + .12, depth: .09 }, scene);
  frame.parent = this.root; frame.material = brass;
  const bezelMaterial = new StandardMaterial('Credit board walnut surround', scene);
  bezelMaterial.diffuseColor = Color3.FromHexString('#18261d'); bezelMaterial.specularColor.set(.08, .08, .08);
  const bezel = MeshBuilder.CreateBox('Credit leaderboard inset bezel', { width: board.width + .04, height: board.height + .04, depth: .035 }, scene);
  bezel.parent = this.root; bezel.position.z = -.05; bezel.material = bezelMaterial;
  const screen = MeshBuilder.CreatePlane('Credit leaderboard screen', { width: board.width, height: board.height }, scene);
  screen.parent = this.root; screen.position.z = -.07;
  this.texture = new DynamicTexture('Credit leaderboard display', { width: 1536, height: 864 }, scene, false);
  const display = new StandardMaterial('Credit leaderboard display', scene);
  display.diffuseTexture = this.texture; display.disableLighting = true; display.emissiveColor = Color3.White(); display.specularColor = Color3.Black();
  screen.material = display;
  this.sync(null, false);
 }
 sync(snapshot: CreditLeaderboard | null, unavailable: boolean) {
  const key = JSON.stringify([snapshot?.entries ?? null, unavailable]);
  if (key === this.lastKey) return;
  this.lastKey = key;
  const next = creditFlaps(snapshot?.entries ?? []);
  const animate = !this.reducedMotion && !!this.snapshot?.entries.length && !!snapshot?.entries.length;
  this.previous = this.cells; this.cells = next;
  this.duration = animate ? Math.max(0, ...next.map((cell, index) => cell.glyph === this.previous[index].glyph ? 0 : cell.delay + CREDIT_FLAP_DURATION)) : 0;
  this.elapsed = 0; this.lastPaint = 0;
  this.snapshot = snapshot; this.unavailable = unavailable;
  this.draw();
 }
 setReducedMotion(reduced: boolean) {
  this.reducedMotion = reduced;
  if (reduced && this.elapsed < this.duration) { this.elapsed = this.duration; this.draw(); }
 }
 update(deltaMs: number, visible: boolean) {
  if (this.elapsed >= this.duration) return;
  this.elapsed = visible && !this.reducedMotion ? Math.min(this.duration, this.elapsed + deltaMs) : this.duration;
  // One texture, at most 30 uploads/second during a roughly one-second transition.
  if (this.elapsed < this.duration && this.elapsed - this.lastPaint < 1000 / 30) return;
  this.lastPaint = this.elapsed; this.draw();
 }
 private draw() {
  const { snapshot, unavailable } = this;
  const ctx = this.texture.getContext() as CanvasRenderingContext2D;
  const width = 1536, height = 864;
  ctx.fillStyle = '#172d24'; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#bca370'; ctx.lineWidth = 2; ctx.strokeRect(25, 25, width - 50, height - 50);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = '#c9b781'; ctx.font = '23px sans-serif'; ctx.fillText('THE MERIDIAN   /   SLOP CITY', 65, 69);
  ctx.fillStyle = '#f0e8d2'; ctx.font = '58px Georgia'; ctx.fillText('Credit leaderboard', 65, 126);
  ctx.textAlign = 'right'; ctx.font = '22px sans-serif'; ctx.fillStyle = '#c9b781'; ctx.fillText('THE TEN RICHEST NEIGHBOURS', width - 65, 126);
  ctx.strokeStyle = '#c9b78166'; ctx.beginPath(); ctx.moveTo(65, 175); ctx.lineTo(width - 65, 175); ctx.stroke();
  if (snapshot?.entries.length) {
   for (const [index, cell] of this.cells.entries()) drawCreditFlap(ctx, this.previous[index], cell, this.duration === 0 ? 1 : Math.max(0, Math.min(1, (this.elapsed - cell.delay) / CREDIT_FLAP_DURATION)));
  } else {
   ctx.textAlign = 'center'; ctx.fillStyle = '#d7dfca'; ctx.font = '35px Georgia';
   ctx.fillText(unavailable ? 'Standings will return shortly.' : snapshot ? 'The first fortunes are still being made.' : 'Finding the richest neighbours…', width / 2, height / 2);
  }
  ctx.textAlign = 'left'; ctx.fillStyle = '#aabbab'; ctx.font = '21px sans-serif'; ctx.fillText('WALLET + POKER CHIPS', 65, 805);
  ctx.textAlign = 'right'; ctx.fillText(unavailable ? 'UPDATES DELAYED' : 'UPDATED EVERY 30 SECONDS', width - 65, 805);
  this.texture.update();
 }
}
