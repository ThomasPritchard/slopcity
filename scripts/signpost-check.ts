import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';

// A renderer-only fixture: no guest sessions, microphone or database writes.
const endpoint = process.env.GAME_URL || 'http://localhost:5173';
const output = 'output/playwright/signpost';
const fixture = `${output}/signpost-fixture.html`;
await mkdir(output, { recursive: true });
const html = `<!doctype html><style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas><script type="module">
import { TownScene } from '/src/world/scene.ts';
const w = new TownScene(document.querySelector('canvas'));
window.world = w;
await w.ready;
w.dayCycle?.setPreviewPhase(.25);
w.setReducedMotion(true);
window.ready = true;
</script>`;
await writeFile(fixture, html);
const bytes = await readFile('public/models/signpost.glb');
assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
const triangles = gltf.meshes.reduce((total: number, mesh: any) => total + mesh.primitives.reduce((n: number, primitive: any) => n + gltf.accessors[primitive.indices].count / 3, 0), 0);
assert.ok(triangles < 6000, 'small prop geometry budget');
assert.ok(bytes.length < 600_000, 'compact self-contained export');
assert.equal(gltf.materials.length, 4);
assert.equal(gltf.meshes.length, 4, 'one exported mesh per material');
assert.equal(gltf.images.length, 1);
assert.equal(gltf.images[0].uri, undefined, 'lettering is embedded');

const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`${endpoint}/${fixture}`);
  await page.waitForFunction(() => (window as any).ready);
  await page.waitForFunction(() => (window as any).world.scene.isReady());
  const asset = await page.evaluate(() => {
    const w = (window as any).world;
    const root = w.scene.getTransformNodeByName('signpost-instance');
    const meshes = root.getChildMeshes().filter((m: any) => m.getTotalVertices() > 0);
    root.computeWorldMatrix(true);
    const bounds = root.getHierarchyBoundingVectors();
    const material = meshes.find((m: any) => m.material?.name === 'Signpost enamel lettering').material;
    return {
      position: root.position.asArray(), size: bounds.max.subtract(bounds.min).asArray(),
      meshes: meshes.length, textureReady: material.albedoTexture.isReady(),
      textureSize: material.albedoTexture.getSize(),
      legacy: !!w.scene.getMeshByName('wayfinding post') || !!w.scene.getMeshByName('sign-TOWN SQUARE'),
      receiveShadows: meshes.every((m: any) => (m.sourceMesh || m).receiveShadows),
    };
  });
  assert.deepEqual(asset.position, [-5.8, .01, -15]);
  assert.ok(asset.size[0] > 2.8 && asset.size[0] < 2.9);
  assert.ok(asset.size[1] > 2.8 && asset.size[1] < 2.9, 'upright metre-scale import');
  assert.ok(asset.size[2] > .3 && asset.size[2] < .4);
  assert.equal(asset.meshes, 4);
  assert.equal(asset.textureReady, true);
  assert.equal(asset.legacy, false, 'old panel and stick removed');
  assert.equal(asset.receiveShadows, true);

  await page.evaluate(() => {
    const w = (window as any).world;
    const drawn = (window as any).signpostDrawn = new Set<string>();
    w.scene.onBeforeRenderObservable.add(() => drawn.clear());
    for (const mesh of w.scene.getTransformNodeByName('signpost-instance').getChildMeshes()) {
      if (!mesh.getTotalVertices()) continue;
      const source = mesh.sourceMesh || mesh;
      source.onAfterRenderObservable.add(() => {
        if (w.engine.currentRenderPassId === w.camera.renderPassId) drawn.add(source.name);
      });
    }
  });

  for (const [name, width, height, alpha, beta, radius, low] of [
    ['front', 1400, 1000, -1.2, 1.35, 6.8, false],
    ['back', 1400, 1000, .9, 1.35, 6.8, false],
    ['phone-portrait', 390, 844, -1.35, 1.3, 10, true],
    ['phone-landscape', 844, 390, -1.35, 1.3, 7, true],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(({ alpha, beta, radius, low }) => {
      const w = (window as any).world;
      w.setQuality(low);
      w.camera.setTarget(new w.camera.target.constructor(-5.8, 1.4, -15));
      w.camera.alpha = alpha; w.camera.beta = beta; w.camera.radius = radius;
    }, { alpha, beta, radius, low });
    await page.waitForFunction(() => (window as any).world.scene.isReady() && (window as any).signpostDrawn.size === 4);
    await page.waitForTimeout(700);
    const facePixels = await page.evaluate(async () => {
      const w = (window as any).world;
      const V = w.camera.target.constructor;
      const identity = w.scene.getTransformMatrix().constructor.Identity();
      const viewport = w.camera.viewport.toGlobal(w.engine.getRenderWidth(), w.engine.getRenderHeight());
      return Promise.all([-.8, 0, .8].map(async x => {
        const point = V.Project(new V(-5.8 + x, 2.01, -15), identity, w.scene.getTransformMatrix(), viewport);
        return Array.from(await w.engine.readPixels(Math.round(point.x), w.engine.getRenderHeight() - Math.round(point.y), 1, 1)) as number[];
      }));
    });
    assert.ok(facePixels.filter(([r, g, b]) => g > r + 3 && g > b).length >= 2, `${name}: green enamel reaches the framebuffer (${JSON.stringify(facePixels)})`);
    await page.screenshot({ path: `${output}/${name}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  if (process.env.BASELINE_URL) {
    const url = `${process.env.BASELINE_URL}/signpost-before-fixture.html`;
    await page.route(url, route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(url);
    await page.waitForFunction(() => (window as any).ready && (window as any).world.scene.isReady());
    await page.evaluate(() => {
      const w = (window as any).world;
      w.camera.setTarget(new w.camera.target.constructor(-5.8, 1.4, -15));
      w.camera.alpha = -1.2; w.camera.beta = 1.35; w.camera.radius = 6.8;
    });
    await page.waitForFunction(() => (window as any).world.scene.isReady());
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${output}/before.png` });
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), browser: browser.version(), triangles, bytes: bytes.length, asset, errors, scope: 'Headless Chromium actual TownScene and exported GLB; desktop and emulated phone layouts. No physical device or multiplayer performance claim.' }, null, 2));
  console.log(`PASS: signpost import, embedded lettering, scale, four material meshes, legacy removal, shadows, desktop/back/mobile renders; ${triangles} triangles, ${bytes.length} bytes.`);
} finally {
  await browser.close();
  await rm(fixture, { force: true });
}
