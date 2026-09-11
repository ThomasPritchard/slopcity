import { webkit, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startRouletteMotion, ROULETTE_ORDER, ROULETTE_GEOMETRY as g, type RouletteMotion } from '../shared/rouletteMotion.ts';

const output = 'output/playwright/roulette-motion';
await mkdir(output, { recursive: true });
const browser = await webkit.launch({ headless: true });
const errors: string[] = [];
const fixture = 'http://localhost:5173/roulette-motion-fixture.html';
async function viewer() {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route(fixture, route => route.fulfill({ contentType: 'text/html', body: `<style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas><script type="module">import{TownScene}from'/src/world/scene.ts';window.world=new TownScene(document.querySelector('canvas'));await world.ready;world.mode='playing';world.studio.setEnabled(false);world.dayCycle.setPreviewPhase(.25);window.sampleTime=20000;world.dayCycle.clock.now=()=>window.sampleTime;world.camera.setTarget(new world.camera.target.constructor(-1.37,2.254,32));world.camera.radius=2.4;world.camera.lowerRadiusLimit=.1;world.camera.alpha=-1.8;world.camera.beta=.55;window.ready=true;</script>` }));
  await page.goto(fixture); await page.waitForFunction(() => (window as any).ready && (window as any).world.scene.isReady());
  await page.evaluate(() => (window as any).world.engine.stopRenderLoop());
  return page;
}

async function sample(page: Page, motion: RouletteMotion, time: number) {
  return page.evaluate(({ motion, time }) => {
    const w = (window as any).world; (window as any).sampleTime = time;
    w.syncCasino({ serverTime: time, tables: [
      { id: 'roulette-1', game: 'roulette', roundId: motion.roundId, phase: time >= motion.landingAt! + 4200 ? 'result' : motion.number === null ? 'spinning' : 'landing', deadline: motion.landingAt! + 4200, result: motion.number, history: [], betCount: 0, motion },
      { id: 'roulette-2', game: 'roulette', roundId: 'other-island', phase: 'betting', deadline: 60000, result: null, history: [32], betCount: 0, motion: null },
    ] });
    w.scene.render();
    const model = w.rouletteModels.get('roulette-1');
    return { ball: model.ball.position.asArray() as number[], wheel: model.wheel.rotation.y as number, otherBall: w.rouletteModels.get('roulette-2').ball.position.asArray() as number[] };
  }, { motion, time });
}

try {
  const owner = await viewer(), spectator = await viewer();
  const spin = { ...startRouletteMotion('same-shared-round', 1000, null), landingAt: 6500, number: 24 };
  const alignment = [];
  for (const [index, number] of ROULETTE_ORDER.entries()) {
    await sample(owner, { ...spin, number }, 20000);
    const contact = await owner.evaluate(({ index, ballRadius }) => {
      const w = (window as any).world, model = w.rouletteModels.get('roulette-1');
      const marker = model.wheel.getChildTransformNodes().find((node: any) => node.name.endsWith('/ball-pocket-0'));
      marker.computeWorldMatrix(true);
      const V = w.camera.target.constructor, R = w.camera.getForwardRay().constructor;
      // Transform the exported Blender marker around its own glTF parent, including
      // Babylon's handedness root. This deliberately does not reuse the motion angle formula.
      const p = marker.position, delta = index / 37 * Math.PI * 2;
      const local = new V(p.x * Math.cos(delta) + p.z * Math.sin(delta), p.y, p.z * Math.cos(delta) - p.x * Math.sin(delta));
      const expected = V.TransformCoordinates(local, marker.parent.getWorldMatrix());
      const meshes = model.wheel.getChildMeshes(); meshes.forEach((mesh: any) => mesh.computeWorldMatrix(true));
      const floor = w.scene.pickWithRay(new R(model.ball.position, new V(0, -1, 0), .06), (mesh: any) => meshes.includes(mesh));
      const blocked = Array.from({ length: 16 }, (_, i) => {
        const angle = i / 16 * Math.PI * 2;
        return !!w.scene.pickWithRay(new R(model.ball.position, new V(Math.cos(angle), 0, Math.sin(angle)), ballRadius + .002), (mesh: any) => meshes.includes(mesh))?.hit;
      });
      return { error: V.Distance(expected, model.ball.position), floorDistance: floor?.distance, blocked: blocked.some(Boolean) };
    }, { index, ballRadius: g.ballRadius });
    assert.ok(contact.error < .00001, `${number}: exported pocket centre ${JSON.stringify(contact)}`);
    assert.ok(Math.abs(contact.floorDistance! - g.ballRadius) < .001, `${number}: ball rests on pocket bed`);
    assert.equal(contact.blocked, false, `${number}: sphere clears the dividers`);
    alignment.push({ number, ...contact });
  }
  const synchrony = [];
  for (const time of [1000, 1800, 3300, 6000, 6499, 6500, 7600, 9000, 10130, 10300, 10700, 20000]) {
    // Owner sees intermediate frames; spectator jumps directly to the latest timestamp.
    await sample(owner, spin, Math.max(1000, time - 25));
    const a = await sample(owner, spin, time), b = await sample(spectator, structuredClone(spin), time);
    assert.deepEqual(a, b, `Independent viewers agree at ${time}`); synchrony.push({ time, ...a });
  }
  await sample(owner, spin, 20000); await owner.screenshot({ path: `${output}/settled-24.png` });
  await sample(owner, { ...spin, number: 0 }, 20000); await owner.screenshot({ path: `${output}/settled-zero.png` });

  // Record a real-time browser render of the shared trajectory, including the commit/release boundary.
  await owner.evaluate(spin => {
    const w = (window as any).world; (window as any).sampleTime = 1000;
    w.syncCasino({ serverTime: 1000, tables: [{ id: 'roulette-1', game: 'roulette', roundId: spin.roundId, phase: 'landing', deadline: 10700, result: spin.number, history: [], betCount: 0, motion: spin }] });
    const canvas = w.canvas as HTMLCanvasElement, chunks: Blob[] = [];
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/mp4' });
    (window as any).recorded = new Promise<string>(resolve => {
      recorder.ondataavailable = event => chunks.push(event.data);
      recorder.onstop = () => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(new Blob(chunks, { type: recorder.mimeType })); };
    });
    const started = performance.now();
    w.dayCycle.clock.now = () => 1000 + performance.now() - started;
    w.engine.runRenderLoop(() => w.scene.render()); recorder.start();
    setTimeout(() => { recorder.stop(); w.engine.stopRenderLoop(); }, 11200);
  }, spin);
  const video = await owner.evaluate(() => (window as any).recorded as Promise<string>);
  await writeFile(`${output}/shared-spin.mp4`, Buffer.from(video, 'base64'));

  await owner.evaluate(() => { const w = (window as any).world; w.dayCycle.clock.now = () => (window as any).sampleTime; w.setReducedMotion(true); });
  const reducedA = await sample(owner, spin, 7600), reducedB = await sample(owner, spin, 9000);
  assert.deepEqual(reducedA, reducedB, 'Reduced motion keeps a steady wheel during the shared spin');
  await sample(owner, spin, 20000); await owner.screenshot({ path: `${output}/reduced-motion-result.png` });
  for (const [name, width, height] of [['portrait', 390, 844], ['landscape', 844, 390]] as const) {
    await owner.setViewportSize({ width, height });
    await owner.evaluate(() => { const w = (window as any).world; w.setQuality(true); w.camera.radius = innerHeight > innerWidth ? 4.3 : 2.4; });
    await sample(owner, spin, 20000); await owner.waitForFunction(() => (window as any).world.scene.isReady());
    await sample(owner, spin, 20000); await owner.screenshot({ path: `${output}/phone-${name}.png` });
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), browser: browser.version(), alignment, synchrony, errors, scope: 'Actual GLB pocket contact for all 37 numbers; two independent browser renderers with different sampling histories; real-time trajectory video, reduced motion and emulated phone renders. Server transport and wagers verified separately.' }, null, 2));
  console.log('PASS: all 37 exported pocket centres, bed contact/divider clearance, two independent viewers, time-based motion video, reduced motion and phone renders.');
} finally { await browser.close(); }
