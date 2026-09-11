import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { CASINO_ANCHORS } from '../shared/casino.ts';
import { floorHeight } from '../shared/casinoLayout.ts';
import { STARTER_OUTFIT } from '../shared/catalog.ts';
const output = 'output/playwright/casino-expansion';
await mkdir(output, { recursive: true });
const exports = [];
for (const name of ['meridian-shell', 'meridian-roof', 'meridian-ceiling', 'meridian-chandelier', 'meridian-interior', 'roulette-table', 'blackjack-table', 'slot-machine', 'casino-chair', 'roulette-wheel', 'craps-table', 'poker-table']) {
 const bytes = await readFile(`public/models/${name}.glb`);
 assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
 const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
 assert.ok((gltf.images ?? []).every((image: any) => !image.uri), `${name}: self-contained images`);
 const triangles = gltf.meshes.reduce((sum: number, mesh: any) => sum + mesh.primitives.reduce((n: number, primitive: any) => n + gltf.accessors[primitive.indices].count / 3, 0), 0);
 exports.push({ name, bytes: bytes.length, triangles, meshes: gltf.meshes.length });
}
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true });
const errors: string[] = [];
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
 page.setDefaultTimeout(60000);
 page.on('pageerror', e => errors.push(e.message));
 page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
 const fixture = 'http://localhost:5173/casino-expansion-fixture.html';
 await page.route(fixture, route => route.fulfill({ contentType: 'text/html', body: `<style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas><script type="module">import{TownScene}from'/src/world/scene.ts';window.world=new TownScene(document.querySelector('canvas'));await world.ready;world.mode='playing';world.studio.setEnabled(false);world.dayCycle.setPreviewPhase(.25);world.setReducedMotion(true);window.ready=true;</script>` }));
 await page.goto(fixture); await page.waitForFunction(() => (window as any).ready && (window as any).world.scene.isReady());
 const setup = await page.evaluate(() => {
  const w = (window as any).world;
  return {
   roulette: w.rouletteModels.size, screens: w.reelTextures.size,
   roots: Object.fromEntries(['roulette-table', 'blackjack-table', 'slot-machine', 'casino-chair', 'craps-table', 'poker-table'].map(name => [name, w.scene.transformNodes.filter((node: any) => node.name === `${name}-instance`).length])),
   positions: w.scene.transformNodes.filter((node: any) => /^(roulette-table|blackjack-table|slot-machine|craps-table|poker-table)-instance$/.test(node.name)).map((node: any) => node.position.asArray()),
   lights: w.scene.lights.filter((light: any) => light.name.startsWith('Meridian marquee')).length,
   glowMaterials: w.scene.materials.filter((material: any) => /^Meridian (neon red|bulb glow|glass glow)/.test(material.name)).map((material: any) => material.name),
   exteriorChaseBounds: w.scene.meshes.filter((mesh: any) => mesh.name.startsWith('meridian-shell/') && /^Meridian (neon red|bulb glow) chase/.test(mesh.material?.name ?? '')).map((mesh: any) => { mesh.computeWorldMatrix(true); return { name: mesh.material.name, rear: mesh.getBoundingInfo().boundingBox.maximumWorld.z }; }),
  };
 });
 assert.deepEqual(setup.roots, { 'roulette-table': 2, 'blackjack-table': 6, 'slot-machine': 24, 'casino-chair': 60, 'craps-table': 1, 'poker-table': 1 });
 assert.equal(setup.roulette, 2); assert.equal(setup.screens, 24); assert.equal(setup.lights, 2); assert.ok(setup.glowMaterials.length >= 3);
 assert.equal(setup.exteriorChaseBounds.length, 11);
 for (const bound of setup.exteriorChaseBounds) assert.ok(bound.rear <= 14.06, `Animated canopy stays outside reception: ${JSON.stringify(bound)}`);
 for (const anchor of CASINO_ANCHORS) assert.ok(setup.positions.some((p: number[]) => Math.abs(p[0] - anchor.x) < .001 && p[1] === .9 && Math.abs(p[2] - anchor.z) < .001), anchor.id);
 const surfaces = await page.evaluate(() => {
  const w = (window as any).world, V = w.camera.target.constructor, R = w.camera.getForwardRay().constructor;
  return [[0, 21], [0, 22.24], [0, 22.72], [0, 23.2], [0, 23.68], [0, 24.16], [0, 25], [8, 23], [12, 23], [18, 23]].map(([x, z]) => {
   const hit = w.scene.pickWithRay(new R(new V(x, 3, z), new V(0, -1, 0), 4), (mesh: any) => /^(meridian-shell|meridian-interior)\//.test(mesh.name));
   return { x, z, height: hit?.pickedPoint?.y ?? -99 };
  });
 });
 for (const surface of surfaces) assert.ok(Math.abs(surface.height - floorHeight(surface.x, surface.z)) < .05, `Visible surface agrees with movement: ${JSON.stringify(surface)}`);
 // The same derived surface height positions citizens; the finished room remains visible inside.
 const profile = { ...STARTER_OUTFIT, name: 'Visitor', profileId: 'fixture', shirt: 0, skin: 1, heading: 0, moving: false, seatId: '', wave: 0 };
 await page.evaluate(profile => { const w = (window as any).world; w.sync(new Map([['local', { ...profile, x: 0, z: 27 }], ['remote', { ...profile, x: 3.5, z: 27 }]])); w.enter('local'); w.sync(w.remote); }, profile);
 await page.waitForTimeout(600);
 assert.deepEqual(await page.evaluate(() => { const w = (window as any).world; return [w.avatars.get('local').root.position.y, w.avatars.get('remote').root.position.y, w.casinoRoof.isEnabled()]; }), [.9, .9, true]);
 const clearance = [];
 for (const pose of [{ x: 0, z: 18, beta: 1.16 }, { x: 0, z: 18, beta: .6 }, { x: 0, z: 23.2, beta: 1.16 }, { x: 0, z: 28, beta: 1.16 }, { x: 0, z: 38, beta: .6 }]) {
  await page.evaluate(({ profile, pose }) => { const w = (window as any).world; w.sync(new Map([['local', { ...profile, ...pose }]])); w.recenter(); w.camera.beta = pose.beta; w.camera.radius = w.appliedRadius = w.requestedRadius = 7.5; }, { profile, pose });
  await page.waitForTimeout(600);
  const state = await page.evaluate(() => {
   const w = (window as any).world, V = w.camera.target.constructor, R = w.camera.getForwardRay().constructor;
   w.camera.getViewMatrix(true);
   const direction = w.camera.position.subtract(w.camera.target), length = direction.length(); direction.normalize();
   const hit = w.scene.pickWithRay(new R(w.camera.target, direction, length + .15), (mesh: any) => w.walls.includes(mesh));
   return { camera: w.camera.position.asArray(), radius: w.camera.radius, clear: !hit?.hit, roof: ['meridian-roof', 'meridian-ceiling', 'meridian-chandelier'].every(name => w.scene.getTransformNodeByName(`${name}-instance`).isEnabled()) };
  });
  assert.ok(state.clear, `Camera stays clear of room solids: ${JSON.stringify({ pose, state })}`);
  assert.ok(state.roof); if (pose.z === 18) assert.ok(state.camera[1] < 3.94, `Foyer view stays below the canopy/ceiling: ${JSON.stringify({ pose, state })}`);
  clearance.push({ pose, ...state });
 }
 await page.evaluate(anchor => (window as any).world.focusCasino(anchor), CASINO_ANCHORS[0]);
 await page.waitForTimeout(600);
 assert.ok(await page.evaluate(() => { const w = (window as any).world; return w.camera.position.y < 7.76 && w.casinoRoof.isEnabled(); }), 'Table framing stays below the visible ceiling');
 await page.evaluate(() => (window as any).world.focusCasino(null));
 await page.evaluate(profile => { const w = (window as any).world; w.sync(new Map([['local', { ...profile, x: 0, z: 11 }]])); }, profile);
 await page.waitForFunction(() => (window as any).world.casinoRoof.isEnabled());
 assert.equal(await page.evaluate(() => (window as any).world.casinoRoof.isEnabled()), true);
 await page.waitForTimeout(350);
 await page.evaluate(() => { const w = (window as any).world; w.localId = null; w.sync(new Map()); w.camera.upperRadiusLimit = 100; w.camera.upperBetaLimit = 2.1; });
 // Independent visible coverage, wheels and reels at all new station anchors.
 await page.evaluate(anchors => {
  const w = (window as any).world;
  const tables = anchors.map(anchor => anchor.game === 'poker' ? { id: 'poker-1', game: 'poker', roundId: 'poker-fixture', handId: null, phase: 'waiting', deadline: 0, button: null, smallBlindSeat: null, bigBlindSeat: null, activeSeat: null, board: [], pot: 0, currentBet: 0, seats: [], pots: [], winners: [], message: 'Waiting for two players' } : anchor.game === 'craps' ? { id: anchor.id, game: 'craps', roundId: 'fixture', rollId: 'fixture-roll', phase: 'betting', deadline: Date.now() + 20000, point: null, shooter: null, betCount: 0, result: null, history: [], motion: null } : anchor.game === 'roulette' ? { id: anchor.id, game: anchor.game, roundId: anchor.id, phase: 'result', deadline: Date.now() + 6000, result: anchor.id === 'roulette-1' ? 0 : 32, betCount: 1, history: [] } : anchor.game === 'blackjack' ? { id: anchor.id, game: anchor.game, roundId: anchor.id, phase: 'playing', deadline: Date.now() + 30000, dealer: [{ rank: '9', suit: 'hearts' }, null], dealerTotal: null, seats: [{ seat: 2, player: { profileId: 'fixture', name: 'Visitor', connected: true }, hands: [{ cards: [{ rank: 'A', suit: 'spades' }, { rank: '7', suit: 'diamonds' }], stake: 10, total: 18, soft: true, state: 'playing', actions: ['hit', 'stand'] }] }], activeSeat: 2, activeHand: 0 } : { id: anchor.id, game: anchor.game, roundId: anchor.id, phase: 'result', deadline: Date.now() + 6000, player: null, reels: ['cherry', 'lemon', 'bar'], stake: 10, returned: 0 });
  w.syncCasino({ serverTime: Date.now(), tables });
  w.syncCasinoPrivate({ rouletteBets: [0, 1].map(i => ({ tableId: `roulette-${i + 1}`, roundId: `roulette-${i + 1}`, wagerId: `${i}`, bet: { kind: 'straight', numbers: [i ? 32 : 0], stake: 10 } })) });
 }, CASINO_ANCHORS);
 await page.waitForTimeout(400);
 const chips = await page.evaluate(() => { const w = (window as any).world; return [1, 2].map(i => w.scene.getMeshByName(`casino-chip-roulette-${i}-own-0`).position.asArray()); });
 assert.ok(chips[0][2] < 33 && chips[1][2] > 43); assert.ok(chips.every(p => p[1] > 2.1));
 const illumination: { light: string; deltas: number[] }[] = [];
 const shots = [
  { name: 'exterior-day', target: [0, 4, 12], radius: 30, alpha: -1.85, beta: 1.32, phase: .25 },
  { name: 'exterior-night', target: [0, 4, 12], radius: 30, alpha: -1.85, beta: 1.32, phase: .75 },
  { name: 'marquee-detail', target: [0, 3.9, 12], radius: 15, alpha: -1.9, beta: 1.36, phase: .75 },
  { name: 'reception', target: [1, 2.4, 21], radius: 6, alpha: -1.7, beta: 1.7, phase: .25 },
  { name: 'arrival', target: [0, 2.5, 24], radius: 6, alpha: -1.57, beta: 1.58, phase: .25 },
  { name: 'foyer-room', target: [0, 1.8, 16.5], radius: 7.2, alpha: 1.57, beta: 1.5, phase: .25, fov: 1.15 },
  { name: 'hall', target: [0, 4.8, 39], radius: 13.5, alpha: -1.57, beta: 1.7, phase: .25 },
  { name: 'hall-night', target: [0, 4.8, 39], radius: 13.5, alpha: -1.57, beta: 1.7, phase: .75 },
  { name: 'chandelier', target: [0, 6.25, 38], radius: 7, alpha: -1.85, beta: 1.85, phase: .25 },
  { name: 'layout', target: [0, .9, 36], radius: 45, alpha: -1.57, beta: .1, phase: .25 },
  { name: 'roulette', target: [0, 2, 32], radius: 6, alpha: -1.7, beta: .65, phase: .25 },
  { name: 'blackjack', target: [-8, 1.8, 30], radius: 5.5, alpha: -1.85, beta: .95, phase: .25 },
  { name: 'slots', target: [-14.6, 2, 28.8], radius: 4.5, alpha: -1.85, beta: 1.2, phase: .25 },
 ];
 for (const shot of shots) {
  await page.evaluate(shot => { const w = (window as any).world; for (const name of ['meridian-roof', 'meridian-ceiling', 'meridian-chandelier']) w.scene.getTransformNodeByName(`${name}-instance`).setEnabled(shot.name !== 'layout'); w.dayCycle.setPreviewPhase(shot.phase); w.camera.setTarget(new w.camera.target.constructor(...shot.target)); w.camera.alpha = shot.alpha; w.camera.beta = shot.beta; w.camera.radius = shot.radius; w.camera.fov = shot.fov ?? .8; }, shot);
  await page.waitForFunction(() => (window as any).world.scene.isReady()); await page.waitForTimeout(500);
  await page.screenshot({ path: `${output}/${shot.name}.png` });
  if (shot.name === 'exterior-night') for (const x of [-8, 8]) {
   const sample = async () => page.evaluate(async x => {
    const w = (window as any).world, V = w.camera.target.constructor, matrix = w.scene.getTransformMatrix();
    const viewport = w.camera.viewport.toGlobal(w.engine.getRenderWidth(), w.engine.getRenderHeight());
    const values: number[] = [];
    for (const dx of [-1.8, -.9, 0, .9, 1.8]) for (const z of [8.5, 9.5, 10.5]) {
     const q = V.Project(new V(x + dx, .024, z), matrix.constructor.Identity(), matrix, viewport);
     const pixels = await w.engine.readPixels(Math.round(q.x), w.engine.getRenderHeight() - Math.round(q.y), 1, 1);
     values.push((pixels[0] + pixels[1] + pixels[2]) / 3);
    }
    return values;
   }, x);
   const on = await sample();
   await page.evaluate(x => (window as any).world.scene.getLightByName(`Meridian marquee light ${x}`).setEnabled(false), x);
   await page.waitForFunction(() => (window as any).world.scene.isReady()); await page.waitForTimeout(350);
   const off = await sample();
   await page.evaluate(x => (window as any).world.scene.getLightByName(`Meridian marquee light ${x}`).setEnabled(true), x);
   await page.waitForFunction(() => (window as any).world.scene.isReady()); await page.waitForTimeout(350);
   const deltas = on.map((value, i) => value - off[i]);
   assert.ok(deltas.filter(value => value > 1).length >= 3, `Marquee ${x} illuminates visible ground pixels: ${deltas}`);
   illumination.push({ light: `Meridian marquee light ${x}`, deltas });
  }

 }
 // Drive the same runtime clock deterministically to verify changing exported material groups.
 const rhythm = await page.evaluate(() => {
  const w = (window as any).world;
  const groups = w.scene.materials.filter((m: any) => /^Meridian (bulb glow|neon red) chase \d+$/.test(m.name));
  const [first, next, steady, steadyLater] = [[0, false], [1000, false], [0, true], [1000, true]].map(([time, reduced]) => {
   w.setReducedMotion(reduced); w.casinoLighting.update(time, 1); return groups.map((m: any) => ({ name: m.name, rgb: m.emissiveColor.asArray() }));
  });
  return { first, next, steady, steadyLater };
 });
 assert.equal(new Set(rhythm.first.map((m: any) => m.name)).size, 11);
 assert.notDeepEqual(rhythm.first, rhythm.next); assert.deepEqual(rhythm.steady, rhythm.steadyLater);
 for (const time of [0, 1000]) {
  await page.evaluate(time => { const w = (window as any).world; w.dayCycle.clock.now = () => time; w.dayCycle.setPreviewPhase(.75); w.setReducedMotion(false); w.camera.setTarget(new w.camera.target.constructor(0, 3.9, 12)); w.camera.radius = 15; w.camera.alpha = -1.9; w.camera.beta = 1.36; }, time);
  await page.waitForTimeout(500); await page.screenshot({ path: `${output}/marquee-rhythm-${time}.png` });
 }
 await page.evaluate(() => (window as any).world.setReducedMotion(true));
 const night = await page.evaluate(() => { const w = (window as any).world; w.dayCycle.setPreviewPhase(.75); return w.scene.lights.filter((l: any) => l.name.startsWith('Meridian marquee')).map((l: any) => l.name); });
 assert.equal(night.length, 2);
 for (const [name, width, height] of [['phone-portrait', 390, 844], ['phone-landscape', 844, 390]] as const) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => { const w = (window as any).world; w.setQuality(true); w.camera.setTarget(new w.camera.target.constructor(0, 4, 12)); w.camera.radius = innerHeight > innerWidth ? 58 : 28; w.camera.alpha = -1.7; w.camera.beta = 1.35; });
  await page.waitForFunction(() => (window as any).world.scene.isReady()); await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => (window as any).world.scene.lights.filter((l: any) => l.name.startsWith('Meridian marquee')).every((l: any) => l.isEnabled() && l.intensity > .5)), true);
  await page.screenshot({ path: `${output}/${name}.png` });
 }
 assert.deepEqual(errors, []);
 await writeFile(`${output}/renderer-${process.env.BROWSER ?? 'chromium'}-results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), browser: browser.version(), exports, setup, surfaces, chips, clearance, rhythm, illumination, errors, scope: 'Actual runtime GLBs and TownScene, synthetic station/player snapshots, shared elevation, enclosed room camera clearance, rhythmic facade emissions and reduced motion, desktop/mobile normal/performance renders. Only layout.png deliberately removes the ceiling for inspection. Gameplay uses separate browser/network checks. Physical-device performance unmeasured.' }, null, 2));
 console.log(`PASS: expanded casino exports, all ${CASINO_ANCHORS.length} stations, independent chips, shared floor heights, enclosed room/camera clearance, animated marquee and reduced motion, steady paving lights and desktop/mobile renders.`);
} finally { await browser.close(); }
