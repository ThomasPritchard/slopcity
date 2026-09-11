import { webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { CASINO_ANCHORS, type CasinoPrivateState, type RouletteBetKind, type RouletteView } from '../shared/casino.ts';
import { rouletteChoices } from '../src/casino/rouletteChoices.ts';

const output = 'output/playwright/casino-improvements';
await mkdir(output, { recursive: true });
const browser = await webkit.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript('window.__name = value => value');
page.setDefaultTimeout(60000);
const url = 'http://localhost:5173/roulette-placement-fixture.html';
const kinds: RouletteBetKind[] = ['low', 'even', 'red', 'black', 'odd', 'high', 'dozen', 'column'];
const bets = kinds.flatMap(kind => rouletteChoices(kind).map(numbers => ({ kind, numbers, stake: 10 })));
const tables: RouletteView[] = ['roulette-1', 'roulette-2'].map(id => ({ id: id as RouletteView['id'], game: 'roulette', roundId: `fixture-${id}`, phase: 'betting', deadline: 60000, result: null, betCount: bets.length, history: [], motion: null }));
const privateState: CasinoPrivateState = { rouletteBets: tables.flatMap(table => bets.map((bet, index) => ({ tableId: table.id, roundId: table.roundId, wagerId: `${table.id}-${index}`, bet }))) };
try {
  await page.route(url, route => route.fulfill({ contentType: 'text/html', body: `<style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas><script type="module">import{TownScene}from'/src/world/scene.ts';window.world=new TownScene(document.querySelector('canvas'));await world.ready;world.mode='playing';world.studio.setEnabled(false);world.dayCycle.setPreviewPhase(.25);world.dayCycle.clock.now=()=>1000;world.setReducedMotion(true);window.ready=true;</script>` }));
  await page.goto(url); await page.waitForFunction(() => (window as any).ready && (window as any).world.scene.isReady());
  await page.evaluate(({ tables, privateState }) => {
    const w = (window as any).world; w.engine.stopRenderLoop(); w.syncCasino({ serverTime: 1000, tables }); w.syncCasinoPrivate(privateState);
  }, { tables, privateState });
  const evidence = [];
  for (const table of tables) {
    const anchor = CASINO_ANCHORS.find(anchor => anchor.id === table.id)!;
    const positions = await page.evaluate(({ anchor, id }) => {
      const w = (window as any).world;
      w.camera.setTarget(new w.camera.target.constructor(anchor.x + .35, 2.1, anchor.z));
      w.camera.radius = w.appliedRadius = w.requestedRadius = 5.8; w.camera.alpha = -Math.PI / 2; w.camera.beta = .22;
      w.scene.render();
      return w.scene.meshes.filter((mesh: any) => mesh.name.startsWith(`casino-chip-${id}-own-`) && mesh.isEnabled()).map((mesh: any) => ({ name: mesh.name, position: mesh.position.asArray() as number[] }));
    }, { anchor, id: table.id }) as { name: string; position: number[] }[];
    assert.equal(positions.length, 12);
    // Independent authored felt coordinates: six outside boxes, three dozens, three columns.
    const expected = [[-.05, -.525], [.35, -.525], [.75, -.525], [1.15, -.525], [1.55, -.525], [1.95, -.525], [.15, -.375], [.95, -.375], [1.75, -.375], [2.29, .44], [2.29, .17], [2.29, -.10]];
    for (const [index, [x, z]] of expected.entries()) {
      const mesh = positions.find(position => position.name === `casino-chip-${table.id}-own-${index}`)!;
      assert.ok(Math.abs(mesh.position[0] - anchor.x - x) < 1e-6 && Math.abs(mesh.position[2] - anchor.z - z) < 1e-6, `${mesh.name} matches its felt marking`);
    }
    await page.screenshot({ path: `${output}/${table.id}-chip-positions.png` });
    evidence.push({ table: table.id, positions });
  }
  // Stale/private bets from another round must disappear from the actual renderer.
  tables[0].roundId = 'next-round';
  await page.evaluate(tables => (window as any).world.syncCasino({ serverTime: 2000, tables }), tables);
  assert.equal(await page.evaluate(() => (window as any).world.scene.meshes.filter((mesh: any) => mesh.name.startsWith('casino-chip-roulette-1-own-') && mesh.isEnabled()).length), 0);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/roulette-placement-results.json`, JSON.stringify({ evidence, errors, scope: 'Actual imported renderer with synthetic accepted bets; both station layouts and stale-round clearing.' }, null, 2));
  console.log('PASS: 24 outside chip placements across both actual roulette tables; stale-round chips clear; no page errors.');
} finally { await browser.close(); }
