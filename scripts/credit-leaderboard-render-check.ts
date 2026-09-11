import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { webkit } from 'playwright';
import { CREDIT_BOARD } from '../shared/creditLeaderboard.ts';

const endpoint = 'http://localhost:5173', output = 'output/playwright/credit-leaderboard';
await mkdir(output, { recursive: true });
const browser = await webkit.launch({ headless: true });
const errors: string[] = [];
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
 page.setDefaultTimeout(90_000);
 page.on('pageerror', error => errors.push(error.message));
 page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
 const snapshot = { updatedAt: Date.now(), entries: ['Florence', 'Big Spender', 'Lucky Lou', 'Tom', 'Midnight Mary', 'Alexander Montgomery', 'Jamie', 'Ruby', 'Theo', 'New Neighbour'].map((name, index) => ({ rank: index + 1, name, credits: 25000 - index * 2300 })) };
 await page.route(`${endpoint}/credit-board-fixture.html`, route => route.fulfill({ contentType: 'text/html', body: `<style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas><script type="module">import{TownScene}from'/src/world/scene.ts';window.world=new TownScene(document.querySelector('canvas'));await world.ready;world.mode='playing';world.dayCycle.setPreviewPhase(.25);world.setReducedMotion(true);world.syncCreditLeaderboard(${JSON.stringify(snapshot)},false);window.ready=true;</script>` }));
 await page.goto(`${endpoint}/credit-board-fixture.html`);
 await page.waitForFunction(() => (window as any).ready && (window as any).world.scene.isReady());
 const bounds = await page.evaluate(() => {
  const root = (window as any).world.scene.getTransformNodeByName('casino-credit-board');
  const bounds = root.getHierarchyBoundingVectors();
  return { min: bounds.min.asArray(), max: bounds.max.asArray(), meshes: root.getChildMeshes().length };
 });
 assert.equal(bounds.meshes, 3);
 assert.ok(bounds.min[1] > 1.625 && bounds.max[1] < 4, 'Frame fits above the dado and below the ceiling');
 assert.ok(bounds.max[0] < 6.85, 'Frame sits in front of the partition wall');
 for (const frame of [
  { name: 'reception', width: 1440, height: 960, alpha: -2.62, beta: 1.43, radius: 7.4, targetY: 2.1, low: false },
  { name: 'wall-detail', width: 1440, height: 960, alpha: Math.PI, beta: 1.43, radius: 5.3, targetY: CREDIT_BOARD.y, low: false },
  { name: 'wall-portrait', width: 390, height: 844, alpha: Math.PI, beta: 1.52, radius: 11.2, targetY: CREDIT_BOARD.y, low: true },
  { name: 'wall-landscape', width: 844, height: 390, alpha: Math.PI, beta: 1.43, radius: 4.6, targetY: CREDIT_BOARD.y, low: true },
 ]) {
  await page.setViewportSize({ width: frame.width, height: frame.height });
  await page.evaluate(({ frame, board }) => {
   const w = (window as any).world;
   w.setQuality(frame.low); w.camera.upperBetaLimit = 1.56; w.camera.setTarget(new w.camera.target.constructor(board.x, frame.targetY, board.z));
   w.camera.alpha = frame.alpha; w.camera.beta = frame.beta; w.camera.radius = frame.radius;
  }, { frame, board: CREDIT_BOARD });
  await page.waitForTimeout(750);
  const visible = await page.evaluate(board => {
   const w = (window as any).world, V = w.camera.target.constructor;
   const matrix = w.scene.getTransformMatrix(), viewport = w.camera.viewport.toGlobal(w.engine.getRenderWidth(), w.engine.getRenderHeight());
   const point = V.Project(new V(board.x - .07, board.y, board.z), matrix.constructor.Identity(), matrix, viewport);
   return w.scene.pick(point.x, point.y)?.pickedMesh?.name;
  }, CREDIT_BOARD);
  assert.equal(visible, 'Credit leaderboard screen', `${frame.name}: wall screen is unobstructed`);
  await page.screenshot({ path: `${output}/${frame.name}.png` });
 }
 await page.setViewportSize({ width: 1440, height: 960 });
 await page.evaluate(board => {
  const w = (window as any).world, display = w.creditBoard;
  w.setQuality(false); w.camera.setTarget(new w.camera.target.constructor(board.x, board.y, board.z));
  w.camera.alpha = Math.PI; w.camera.beta = 1.43; w.camera.radius = 5.3;
  // Freeze only the animation clock for repeatable intermediate renderer captures.
  (window as any).stepBoard = display.update.bind(display); display.update = () => {};
  (window as any).uploads = 0;
  const update = display.texture.update.bind(display.texture);
  display.texture.update = (...args: unknown[]) => { (window as any).uploads++; return update(...args); };
  (window as any).flapHash = (row: number) => {
   const pixels = display.texture.getContext().getImageData(50, 185 + row * 55, 1430, 50).data;
   let hash = 2166136261; for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619); return hash;
  };
  w.setReducedMotion(false);
 }, CREDIT_BOARD);
 const before = await page.evaluate(() => [(window as any).flapHash(0), (window as any).flapHash(9)]);
 const next = { ...snapshot, updatedAt: Date.now(), entries: snapshot.entries.map((entry, i) => i === 0 ? { ...entry, name: 'Florence Wins', credits: 27500 } : entry) };
 await page.evaluate(next => (window as any).world.syncCreditLeaderboard(next, false), next);
 const start = await page.evaluate(() => [(window as any).flapHash(0), (window as any).flapHash(9)]);
 assert.deepEqual(start, before, 'Changed text starts on its old leaf');
 const hashes: number[] = [];
 let previous = 0;
 for (const time of [140, 280, 420, 660, 1080]) {
  await page.evaluate(delta => (window as any).stepBoard(delta, true), time - previous); previous = time;
  await page.waitForTimeout(90);
  const state = await page.evaluate(() => [(window as any).flapHash(0), (window as any).flapHash(9)]);
  hashes.push(state[0]); assert.equal(state[1], before[1], 'Unchanged row does not animate');
  await page.screenshot({ path: `${output}/flip-${time}.png` });
 }
 assert.ok(new Set(hashes).size >= 3, 'Changed row has multiple rendered flip phases');
 const animation = await page.evaluate(next => {
  const w = (window as any).world, displayed = w.creditBoard;
  const settled = (window as any).flapHash(0), uploads = (window as any).uploads;
  w.syncCreditLeaderboard({ ...next, updatedAt: Date.now() + 1 }, false); (window as any).stepBoard(1000, true);
  const unchangedUploads = (window as any).uploads - uploads;
  w.setReducedMotion(true); w.syncCreditLeaderboard({ ...next, entries: next.entries.map((entry: any, i: number) => i === 0 ? { ...entry, credits: 28000 } : entry) }, false);
  const reduced = (window as any).flapHash(0), reducedUploads = (window as any).uploads;
  (window as any).stepBoard(500, true);
  return { settled, unchangedUploads, reduced, reducedMoving: displayed.elapsed < displayed.duration, extraReducedUploads: (window as any).uploads - reducedUploads };
 }, next);
 assert.equal(animation.unchangedUploads, 0, 'A refreshed timestamp does not repaint or animate');
 assert.notEqual(animation.settled, animation.reduced);
 assert.equal(animation.reducedMoving, false); assert.equal(animation.extraReducedUploads, 0);
 assert.deepEqual(errors, []);
 await writeFile(`${output}/render-results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), bounds, animation, errors, scope: 'Actual TownScene with fixed sample standings; mounting, occlusion, split-flap phases, reduced motion, no idle uploads and desktop/emulated phone views. No physical-device performance claim.' }, null, 2));
 console.log('PASS: reception mounting, visible desktop/phone renders, staggered split-flap phases, unchanged rows, reduced motion and no idle uploads');
} finally { await browser.close(); }
