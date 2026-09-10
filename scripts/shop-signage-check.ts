import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const endpoint = process.env.GAME_URL || 'http://localhost:5173';
const output = 'output/playwright/shop-signage';
await mkdir(output, { recursive: true });
const definitions = [
  { name: 'shop-sign', legacy: 'FORM & THREAD', x: 17.5, y: 4.48, width: 5.5, height: .9 },
  { name: 'shop-tagline', legacy: 'Find your everyday.', x: 25.68, y: 3, width: 6, height: 1.4 },
];
const exports = [];
for (const { name } of definitions) {
  const bytes = await readFile(`public/models/${name}.glb`);
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const triangles = gltf.meshes.reduce((n: number, m: any) => n + m.primitives.reduce((sum: number, p: any) => sum + gltf.accessors[p.indices].count / 3, 0), 0);
  assert.ok(triangles < 3000 && bytes.length < 450_000, `${name}: small wall-prop budget`);
  assert.equal(gltf.meshes.length, 4);
  assert.equal(gltf.materials.length, 4);
  assert.equal(gltf.images.length, 1);
  assert.equal(gltf.images[0].uri, undefined, 'lettering is embedded');
  exports.push({ name, triangles, bytes: bytes.length });
}

const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  // Fulfil the renderer-only fixture in memory: no guest/database state or Vite reloads.
  const fixture = `${endpoint}/shop-signage-fixture.html`;
  await page.route(fixture, route => route.fulfill({ contentType: 'text/html', body: `
    <style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas>
    <script type="module">import{TownScene}from'/src/world/scene.ts';window.world=new TownScene(document.querySelector('canvas'));await world.ready;world.dayCycle.setPreviewPhase(.25);world.setReducedMotion(true);window.ready=true;</script>` }));
  await page.goto(fixture);
  await page.waitForFunction(() => (window as any).ready && (window as any).world.scene.isReady());
  for (const definition of definitions) {
    const asset = await page.evaluate(({ name, legacy }) => {
      const w = (window as any).world;
      const root = w.scene.getTransformNodeByName(`${name}-instance`);
      root.computeWorldMatrix(true);
      const bounds = root.getHierarchyBoundingVectors();
      const meshes = root.getChildMeshes().filter((m: any) => m.getTotalVertices());
      return { position: root.position.asArray(), size: bounds.max.subtract(bounds.min).asArray(),
        meshes: meshes.length, copies: meshes.every((m: any) => !m.sourceMesh),
        textureReady: meshes.find((m: any) => m.material.name === `${name} enamel lettering`).material.albedoTexture.isReady(),
        legacy: !!w.scene.getMeshByName(`sign-${legacy}`) };
    }, definition);
    assert.deepEqual(asset.position, [definition.x, definition.y, -2]);
    assert.ok(Math.abs(asset.size[2] - definition.width) < .01 && Math.abs(asset.size[1] - definition.height) < .01);
    assert.equal(asset.meshes, 4);
    assert.equal(asset.copies, true);
    assert.equal(asset.textureReady, true);
    assert.equal(asset.legacy, false);
  }

  const frames = [
    { name: 'exterior', sign: 0, width: 1440, height: 1000, targetY: 3, alpha: Math.PI + .25, beta: 1.35, radius: 13, low: false },
    { name: 'exterior-detail', sign: 0, width: 1440, height: 900, targetY: 4.48, alpha: Math.PI + .28, beta: 1.35, radius: 7.5, low: false },
    { name: 'interior', sign: 1, width: 1440, height: 1000, targetY: 2.8, alpha: Math.PI + .18, beta: 1.3, radius: 6.7, low: false },
    { name: 'phone-portrait', sign: 0, width: 390, height: 844, targetY: 3.4, alpha: Math.PI + .1, beta: 1.45, radius: 20, low: true },
    { name: 'phone-landscape', sign: 0, width: 844, height: 390, targetY: 3.6, alpha: Math.PI + .15, beta: 1.4, radius: 10, low: true },
    { name: 'interior-performance', sign: 1, width: 844, height: 390, targetY: 3, alpha: Math.PI + .1, beta: 1.4, radius: 7.5, low: true },
  ];
  for (const frame of frames) {
    const sign = definitions[frame.sign];
    await page.setViewportSize({ width: frame.width, height: frame.height });
    await page.evaluate(({ frame, sign }) => {
      const w = (window as any).world;
      w.setQuality(frame.low);
      w.camera.setTarget(new w.camera.target.constructor(sign.x, frame.targetY, -2));
      w.camera.alpha = frame.alpha; w.camera.beta = frame.beta; w.camera.radius = frame.radius;
    }, { frame, sign });
    await page.waitForFunction(() => (window as any).world.scene.isReady());
    await page.waitForTimeout(700);
    const pixels = await page.evaluate(async sign => {
      const w = (window as any).world, V = w.camera.target.constructor;
      const matrix = w.scene.getTransformMatrix(), identity = matrix.constructor.Identity();
      const viewport = w.camera.viewport.toGlobal(w.engine.getRenderWidth(), w.engine.getRenderHeight());
      return Promise.all([-.9, 0, .9].map(async z => {
        // Clear green strip below the lettering, above the inset keyline.
        const point = V.Project(new V(sign.x - .058, sign.y - (sign.height - .14) * .27, -2 + z), identity, matrix, viewport);
        return Array.from(await w.engine.readPixels(Math.round(point.x), w.engine.getRenderHeight() - Math.round(point.y), 1, 1)) as number[];
      }));
    }, sign);
    await page.screenshot({ path: `${output}/${frame.name}.png` });
    assert.ok(pixels.filter(([r, g, b]) => g > r + 3 && g > b).length >= 2, `${frame.name}: visible enamel pixels ${JSON.stringify(pixels)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), browser: browser.version(), exports, errors, scope: 'Actual TownScene and Blender exports; desktop and emulated phone portrait/landscape, normal/performance rendering. No physical-device or multiplayer performance claim.' }, null, 2));
  console.log('PASS: shop fascia and interior plaque import, scale, embedded lettering, legacy removal, visible pixels, desktop/mobile and performance-mode captures.', exports);
} finally { await browser.close(); }
