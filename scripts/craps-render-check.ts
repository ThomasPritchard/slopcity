import { webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolveCraps, type CrapsView } from '../shared/craps.ts';
import { CRAPS_ROLL_MS, type CrapsMotion } from '../shared/crapsMotion.ts';

const output = 'output/playwright/craps';
await mkdir(output, { recursive: true });
const browser = await webkit.launch({ headless: true }), errors: string[] = [];
async function viewer() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  page.setDefaultTimeout(60000); page.on('pageerror', e => errors.push(e.message));
  const fixture = 'http://localhost:5173/craps-render-fixture.html';
  await page.route(fixture, route => route.fulfill({ contentType: 'text/html', body: `<style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas><script type="module">import{TownScene}from'/src/world/scene.ts';window.world=new TownScene(document.querySelector('canvas'));await world.ready;world.mode='playing';world.studio.setEnabled(false);world.dayCycle.setPreviewPhase(.25);window.sampleTime=1000;world.dayCycle.clock.now=()=>window.sampleTime;world.camera.setTarget(new world.camera.target.constructor(-11.5,1.95,51.4));world.camera.radius=6.4;world.camera.alpha=-1.57;world.camera.beta=.64;window.ready=true;</script>` }));
  await page.goto(fixture); await page.waitForFunction(() => (window as any).ready && (window as any).world.scene.isReady());
  await page.evaluate(() => (window as any).world.engine.stopRenderLoop());
  return page;
}
const view = (motion: CrapsMotion, time: number): CrapsView => {
  const landed = time >= motion.startedAt + CRAPS_ROLL_MS, result = resolveCraps(motion.dice, null);
  return { id: 'craps-1', game: 'craps', roundId: 'render-cycle', rollId: motion.rollId, phase: landed ? 'result' : 'rolling', deadline: motion.startedAt + CRAPS_ROLL_MS, point: landed ? result.pointAfter : null, shooter: { profileId: 'owner', name: 'Tom', connected: true }, betCount: 3, result: landed ? result : null, history: landed ? [result] : [], motion };
};
async function sample(page: Awaited<ReturnType<typeof viewer>>, motion: CrapsMotion, time: number) {
  return page.evaluate(({ table, time }) => {
    const w = (window as any).world; (window as any).sampleTime = time;
    w.syncCasino({ serverTime: time, tables: [table] });
    w.syncCasinoPrivate({ rouletteBets: [], crapsBets: [{ tableId: 'craps-1', roundId: 'render-cycle', wagerId: 'own', bet: { kind: 'pass', stake: 30 } }] }); w.scene.render();
    const V = w.camera.target.constructor, R = w.camera.getForwardRay().constructor;
    const dice = [0, 1].map(index => {
      const root = w.scene.getTransformNodeByName(`craps-die-${index}`), mesh = w.scene.getMeshByName(`craps-live/die-${index}`);
      root.computeWorldMatrix(true); mesh.computeWorldMatrix(true);
      const faces = [1, 2, 3, 4, 5, 6].map(value => ({ value, y: w.scene.getTransformNodeByName(`craps-face-${index}-${value}`).getAbsolutePosition().y }));
      const vertices = mesh.getVerticesData('position'), points = [];
      for (let i = 0; i < vertices.length; i += 3) points.push(V.TransformCoordinates(V.FromArray(vertices, i), mesh.getWorldMatrix()).asArray());
      const floor = w.scene.pickWithRay(new R(root.position, new V(0, -1, 0), 2), (m: any) => m.name.startsWith('craps-table/'));
      return { position: root.position.asArray(), rotation: root.rotationQuaternion.asArray(), top: faces.sort((a, b) => b.y - a.y)[0].value, low: Math.min(...points.map(p => p[1])), highX: Math.max(...points.map(p => p[0])), minZ: Math.min(...points.map(p => p[2])), maxZ: Math.max(...points.map(p => p[2])), floor: floor?.pickedPoint?.y };
    });
    const marker = w.scene.getTransformNodeByName('craps-table-instance').getChildTransformNodes().find((n: any) => n.name.endsWith('/felt-origin'));
    marker.computeWorldMatrix(true);
    return { dice, felt: marker.getAbsolutePosition().asArray(), ownChip: w.scene.getMeshByName('craps-live/chip-0').isEnabled() };
  }, { table: view(motion, time), time });
}
try {
  const owner = await viewer(), spectator = await viewer(), alignment = [];
  assert.ok(await owner.evaluate(() => {
    const mesh = (window as any).world.scene.getMeshByName('craps-live/die-0'), vertices = mesh.getVerticesData('position'), normals = mesh.getVerticesData('normal');
    for (let i = 0; i < vertices.length; i += 3) if (vertices[i] * normals[i] + vertices[i + 1] * normals[i + 1] + vertices[i + 2] * normals[i + 2] <= 0) return false;
    return true;
  }), 'Die faces have outward normals and opaque visible surfaces');
  const motion: CrapsMotion = { rollId: 'shared-render-throw', startedAt: 1000, dice: [3, 5], previousDice: [1, 1] };
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
    const state = await sample(owner, { ...motion, dice: [a, b] }, 8000);
    assert.deepEqual(state.dice.map(d => d.top), [a, b], 'Rendered top faces agree with the announced dice');
    for (const die of state.dice) {
      assert.ok(Math.abs(die.low - 1.94) < .00001, 'Die rests on the actual felt');
      assert.ok(Math.abs(die.floor - state.felt[1]) < .001, 'Exported felt marker matches imported surface');
    }
    assert.equal(state.ownChip, true); alignment.push(state);
  }
  const samples = [];
  for (let time = 1000; time <= 5300; time += 50) {
    const state = await sample(owner, motion, time);
    for (const die of state.dice) {
      assert.ok(die.low >= 1.94 - .00001, `No felt penetration at ${time}`);
      assert.ok(die.highX <= -11.5 + 2.53, `No back wall penetration at ${time}`);
      assert.ok(die.minZ > 51.4 - .98 && die.maxZ < 51.4 + .98, 'Dice stay inside the well');
    }
    if (time % 500 === 0) { const other = await sample(spectator, structuredClone(motion), time); assert.deepEqual(state, other, 'Different frame histories agree'); samples.push({ time, ...state }); }
  }
  await sample(owner, motion, 8000); await owner.screenshot({ path: `${output}/browser-table.png` });
  await owner.evaluate(() => { const w = (window as any).world; w.camera.lowerRadiusLimit = .3; w.camera.radius = w.appliedRadius = w.requestedRadius = 1.8; w.camera.setTarget(new w.camera.target.constructor(-9.85, 2.03, 51.4)); });
  await sample(owner, motion, 8000); await owner.screenshot({ path: `${output}/browser-dice.png` });
  await owner.evaluate(() => { const w = (window as any).world; w.camera.radius = 6.4; w.camera.setTarget(new w.camera.target.constructor(-11.5, 1.95, 51.4)); });
  await owner.evaluate(table => {
    const w = (window as any).world; w.syncCasino({ serverTime: 1000, tables: [table] });
    const recorder = new MediaRecorder(w.canvas.captureStream(30), { mimeType: 'video/mp4' }), chunks: Blob[] = [];
    (window as any).recorded = new Promise<string>(resolve => {
      recorder.ondataavailable = e => chunks.push(e.data); recorder.onstop = () => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(new Blob(chunks, { type: recorder.mimeType })); };
    });
    const started = performance.now(); w.dayCycle.clock.now = () => 700 + performance.now() - started;
    w.engine.runRenderLoop(() => w.scene.render()); recorder.start(); setTimeout(() => { recorder.stop(); w.engine.stopRenderLoop(); }, 5400);
  }, view(motion, 1000));
  await writeFile(`${output}/shared-throw.mp4`, Buffer.from(await owner.evaluate(() => (window as any).recorded as Promise<string>), 'base64'));
  await owner.evaluate(() => { const w = (window as any).world; w.dayCycle.clock.now = () => (window as any).sampleTime; w.setReducedMotion(true); });
  const before = await sample(owner, motion, 1100), after = await sample(owner, motion, 5100); assert.deepEqual(before.dice, after.dice);
  const reduced = await sample(owner, motion, 8000); assert.deepEqual(reduced.dice.map(d => d.top), [3, 5]);
  for (const [name, width, height] of [['portrait', 390, 844], ['landscape', 844, 390]] as const) {
    await owner.setViewportSize({ width, height }); await owner.evaluate(() => { const w = (window as any).world; w.setQuality(true); w.camera.radius = innerHeight > innerWidth ? 10 : 6.4; });
    await sample(owner, motion, 8000); await owner.waitForFunction(() => (window as any).world.scene.isReady()); await sample(owner, motion, 8000);
    await owner.screenshot({ path: `${output}/browser-${name}.png` });
  }
  assert.deepEqual(errors, []); await writeFile(`${output}/renderer-results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), browser: browser.version(), alignment, samples, errors }, null, 2));
  console.log('PASS: 36 dice combinations match actual top faces, imported felt contact, no throw penetration, independent viewers, reduced motion and mobile renders.');
} finally { await browser.close(); }
