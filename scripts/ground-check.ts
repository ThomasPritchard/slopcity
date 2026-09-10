import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { SEATS } from '../shared/social.ts';

const endpoint = process.env.GAME_URL || 'http://localhost:5173';
const kind = process.env.BROWSER === 'webkit' ? 'webkit' : 'chromium';
const output = `output/playwright/ground/${kind}`;
await mkdir(output, { recursive: true });
const bytes = await readFile('public/models/town-ground.glb');
assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
const triangles = gltf.meshes.reduce((n: number, m: any) => n + m.primitives.reduce((n: number, p: any) => n + gltf.accessors[p.indices].count / 3, 0), 0);
assert.ok(triangles < 12_000 && bytes.length < 8_000_000, 'bounded ground export');
assert.equal(gltf.meshes.length, 5); assert.equal(gltf.images.length, 9);
assert.ok(gltf.images.every((i: any) => i.bufferView !== undefined && !i.uri), 'all original PBR maps embedded');
for (const name of ['Ground fan-laid limestone', 'Ground compacted gravel', 'Ground dressed limestone']) {
  const material = gltf.materials.find((m: any) => m.name === name);
  assert.ok(material.normalTexture && material.pbrMetallicRoughness.baseColorTexture && material.pbrMetallicRoughness.metallicRoughnessTexture);
}
assert.ok(gltf.materials.find((m: any) => m.name === 'Ground charcoal limestone edging').pbrMetallicRoughness.baseColorFactor.slice(0, 3).every((n: number) => n < .3), 'dark border colour survives export');
assert.ok(gltf.meshes.find((m: any) => m.name === 'Ground dressed limestone').primitives[0].attributes.COLOR_0 !== undefined, 'stone variation uses the runtime colour channel');
const browser = await (kind === 'webkit' ? webkit : chromium).launch({ headless: true });
const errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(90_000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  const fixture = `${endpoint}/ground-check-fixture.html`;
  await page.route(fixture, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas><script type="module">
    import{TownScene}from'/src/world/scene.ts';window.w=new TownScene(document.querySelector('canvas'));await w.ready;w.dayCycle.setPreviewPhase(.25);w.setReducedMotion(true);window.ready=true;
  </script>` }));
  await page.goto(fixture); await page.waitForFunction(() => (window as any).ready && (window as any).w.scene.isReady());
  console.log('Ground renderer ready');
  const setup = await page.evaluate(() => {
    const w = (window as any).w, root = w.scene.getTransformNodeByName('town-ground-instance');
    const meshes = root.getChildMeshes().filter((m: any) => m.getTotalVertices());
    return { position: root.position.asArray(), meshes: meshes.map((m: any) => ({ name: m.name, material: m.material.name, copies: !m.sourceMesh, receivesShadows: m.receiveShadows, lightBudget: m.material.maxSimultaneousLights })),
      oldGrid: w.scene.meshes.some((m: any) => ['square', 'paving joint', 'main promenade', 'cross promenade'].includes(m.name)),
      groundCasters: w.shadows.getShadowMap().renderList.some((m: any) => m.name.startsWith('town-ground/')) };
  });
  assert.deepEqual(setup.position, [0, 0, 0]); assert.equal(setup.meshes.length, 5);
  assert.ok(setup.meshes.every((m: any) => m.copies && m.receivesShadows && m.lightBudget >= 6));
  assert.equal(setup.oldGrid, false); assert.equal(setup.groundCasters, false);
  const sites = [
    { name: 'arrival', x: 0, z: -17, stone: true }, { name: 'west route', x: -14, z: -2, stone: true },
    { name: 'shop threshold', x: 18.2, z: -2, stone: true }, { name: 'casino threshold', x: 0, z: 13.8, stone: true },
    { name: 'fountain apron', x: 5, z: .7, stone: true },
    { name: 'west gravel', x: -6, z: -15, stone: false }, { name: 'east gravel', x: 7, z: -16, stone: false },
    ...SEATS.flatMap(seat => [{ name: seat.id, x: seat.x, z: seat.z, stone: true }, { name: `${seat.id} exit`, ...seat.exit, stone: true }]),
  ];
  const surfaces = await page.evaluate(sites => {
    const w = (window as any).w;
    return sites.map(site => {
      // Use the existing camera Ray/Vector types without extra fixture dependencies.
      const ray = w.camera.getForwardRay(1);
      ray.origin.set(site.x, .15, site.z); ray.direction.set(0, -1, 0);
      const hit = w.scene.pickWithRay(ray, (m: any) => m.name.startsWith('town-ground/'));
      return { ...site, material: hit?.pickedMesh?.material?.name, height: hit?.pickedPoint?.y };
    });
  }, sites);
  for (const site of surfaces) {
    assert.ok(site.material && site.height >= .0019 && site.height <= .0241, `${site.name}: ground stays near the existing movement plane`);
    assert.equal(site.material !== 'Ground compacted gravel', site.stone, `${site.name}: correct surface`);
  }
  const aim = async (x: number, z: number, radius: number, alpha = -1.25, beta = .65, y = .02) => {
    await page.evaluate(view => { const w = (window as any).w, [x, y, z, alpha, beta, radius] = view; w.camera.setTarget(new w.camera.target.constructor(x, y, z)); w.camera.alpha = alpha; w.camera.beta = beta; w.camera.radius = radius; }, [x, y, z, alpha, beta, radius]);
    await page.waitForFunction(() => (window as any).w.scene.isReady()); await page.waitForTimeout(300);
  };
  const before = () => page.evaluate(async () => { const w = (window as any).w; (window as any).pixels = await w.engine.readPixels(0, 0, w.engine.getRenderWidth(), w.engine.getRenderHeight()); });
  const difference = () => page.evaluate(async () => {
    const w = (window as any).w, a = (window as any).pixels, b = await w.engine.readPixels(0, 0, w.engine.getRenderWidth(), w.engine.getRenderHeight());
    let changed = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]) > 12) changed++;
    return changed;
  });
  const relief = [];
  for (const low of [false, true]) {
    await page.evaluate(low => (window as any).w.setQuality(low), low);
    for (const [name, x, z, radius] of [['Ground fan-laid limestone', 1, -13, 5], ['Ground compacted gravel', -5.3, -15, 3.5]] as const) {
      await aim(x, z, radius); await before();
      await page.evaluate(name => { const w = (window as any).w, mat = w.scene.materials.find((m: any) => m.name === name); (window as any).testMaterial = mat; (window as any).bumpLevel = mat.bumpTexture.level; mat.bumpTexture.level = 0; w.scene.resetCachedMaterial(); }, name);
      await page.waitForFunction(() => (window as any).w.scene.isReady()); await page.waitForTimeout(300);
      const pixels = await difference(); assert.ok(pixels > 1000, `${name}, low=${low}: normal-map relief changes actual pixels (${pixels})`);
      await page.evaluate(() => { (window as any).testMaterial.bumpTexture.level = (window as any).bumpLevel; (window as any).w.scene.resetCachedMaterial(); });
      await page.waitForFunction(() => (window as any).w.scene.isReady()); await page.waitForTimeout(300);
      relief.push({ name, low, pixels }); console.log(`${name}, performance=${low}: ${pixels} relief pixels`);
      await page.screenshot({ path: `${output}/${name.includes('gravel') ? 'gravel' : 'stone'}-${low ? 'performance' : 'normal'}.png` });
    }
  }
  await page.evaluate(() => (window as any).w.setQuality(false));
  for (const [name, x, z, radius, beta] of [['arrival', 0, -15, 15, .9], ['fountain', 0, 1, 21, .62], ['square', 0, -3, 46, .55]] as const) {
    await aim(x, z, radius, -1.4, beta); await page.screenshot({ path: `${output}/${name}.png` });
  }
  await page.evaluate(() => (window as any).w.dayCycle.setPreviewPhase(.75));
  await aim(0, -7, 27, -1.3, .95); await page.screenshot({ path: `${output}/night.png` });
  assert.ok(await page.evaluate(() => (window as any).w.lampLighting.lights.every((l: any) => l.intensity > .6)));
  await page.evaluate(() => (window as any).w.dayCycle.setPreviewPhase(.25));
  for (const [name, width, height, radius] of [['phone-portrait', 390, 844, 22], ['phone-landscape', 844, 390, 15]] as const) {
    await page.setViewportSize({ width, height }); await page.evaluate(() => (window as any).w.setQuality(true));
    await aim(0, -15, radius, -1.22, .9); await page.screenshot({ path: `${output}/${name}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await page.evaluate(() => (window as any).w.setQuality(false)); await page.waitForTimeout(500);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), browser: browser.version(), triangles, bytes: bytes.length, setup, surfaces, relief, errors,
    scope: 'Actual authored ground in TownScene. Material export, route and seating/exit coverage, normal-map pixel evidence in both quality modes, day/night and headless desktop/emulated phone. No network or physical-device performance claim.' }, null, 2));
  console.log('PASS: ground import, routes and all seating exits, visible stone/gravel relief, normal/performance, day/night and mobile captures.');
} finally { await browser.close(); }
