import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const endpoint = process.env.GAME_URL || 'http://localhost:5173';
const output = 'output/playwright/casino-signage';
await mkdir(output, { recursive: true });
const definitions = [
  { name: 'casino-sign', legacy: 'THE MERIDIAN', y: 5.4, z: 13.75, width: 10, height: 1.7, hangingDrop: 0 },
  { name: 'casino-entry-sign', legacy: 'C A S I N O', y: 3.77, z: 11.12, width: 2.4, height: .5, hangingDrop: .28 },
  { name: 'casino-tagline', legacy: 'A little luck. Good company.', y: 4.35, z: 55.68, width: 10, height: 2, hangingDrop: 0 },
];
const exports = [];
for (const { name } of definitions) {
  const bytes = await readFile(`public/models/${name}.glb`);
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const triangles = gltf.meshes.reduce((n: number, m: any) => n + m.primitives.reduce((sum: number, p: any) => sum + gltf.accessors[p.indices].count / 3, 0), 0);
  assert.ok(triangles < 4000 && bytes.length < 450_000, `${name}: small signage budget`);
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
  const fixture = `${endpoint}/casino-signage-fixture.html`;
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
      return { position: root.position.asArray(), bottom: bounds.min.y, top: bounds.max.y, size: bounds.max.subtract(bounds.min).asArray(),
        meshes: meshes.length, copies: meshes.every((m: any) => !m.sourceMesh),
        textureReady: meshes.find((m: any) => m.material.name === `${name} enamel lettering`).material.albedoTexture.isReady(),
        legacy: !!w.scene.getMeshByName(`sign-${legacy}`) };
    }, definition);
    assert.deepEqual(asset.position, [0, definition.y, definition.z]);
    assert.ok(Math.abs(asset.size[0] - definition.width) < .01 && Math.abs(asset.size[1] - definition.height - definition.hangingDrop) < .01);
    assert.equal(asset.meshes, 4);
    assert.equal(asset.copies, true);
    assert.equal(asset.textureReady, true);
    assert.equal(asset.legacy, false);
    if (definition.name === 'casino-sign') assert.ok(asset.bottom > 4.5 && asset.top < 6.35, 'fascia clears canopy and parapet');
    if (definition.hangingDrop) assert.ok(Math.abs(asset.top - 4.3) < .002, 'hangers embed in the marquee fascia');
    if (definition.name === 'casino-tagline') assert.ok(asset.bottom > 3.275, 'slogan clears timber panels and lights');
  }

  const frames = [
    { name: 'exterior', sign: 0, width: 1440, height: 1000, targetY: 4.6, alpha: -Math.PI / 2 - .13, beta: 1.35, radius: 17, low: false },
    { name: 'fascia-detail', sign: 0, width: 1440, height: 900, targetY: 5.4, alpha: -Math.PI / 2 - .18, beta: 1.35, radius: 12, low: false },
    { name: 'entry', sign: 1, width: 1440, height: 1000, targetY: 3.9, alpha: -Math.PI / 2 - .15, beta: 1.43, radius: 5.5, low: false },
    { name: 'interior', sign: 2, width: 1440, height: 1000, targetY: 3.9, alpha: -Math.PI / 2 - .08, beta: 1.4, radius: 12, low: false },
    { name: 'phone-portrait', sign: 0, width: 390, height: 844, targetY: 4.5, alpha: -Math.PI / 2 - .04, beta: 1.45, radius: 34, low: true },
    { name: 'phone-landscape', sign: 0, width: 844, height: 390, targetY: 4.6, alpha: -Math.PI / 2 - .1, beta: 1.4, radius: 16, low: true },
    { name: 'entry-performance', sign: 1, width: 844, height: 390, targetY: 3.9, alpha: -Math.PI / 2 - .1, beta: 1.4, radius: 5.5, low: true },
    { name: 'interior-performance', sign: 2, width: 844, height: 390, targetY: 4.35, alpha: -Math.PI / 2 - .08, beta: 1.4, radius: 12, low: true },
  ];
  for (const frame of frames) {
    const sign = definitions[frame.sign];
    await page.setViewportSize({ width: frame.width, height: frame.height });
    await page.evaluate(({ frame, sign }) => {
      const w = (window as any).world;
      w.setQuality(frame.low);
      w.camera.setTarget(new w.camera.target.constructor(0, frame.targetY, sign.z));
      w.camera.alpha = frame.alpha; w.camera.beta = frame.beta; w.camera.radius = frame.radius;
    }, { frame, sign });
    await page.waitForFunction(() => (window as any).world.scene.isReady());
    await page.waitForTimeout(700);
    const pixels = await page.evaluate(async sign => {
      const w = (window as any).world, V = w.camera.target.constructor;
      const matrix = w.scene.getTransformMatrix(), identity = matrix.constructor.Identity();
      const viewport = w.camera.viewport.toGlobal(w.engine.getRenderWidth(), w.engine.getRenderHeight());
      return Promise.all([-.08, 0, .08].map(async offset => {
        // Clear green strip below the lettering, above the inset keyline.
        const point = V.Project(new V(sign.width * offset, sign.y - (sign.height - .14) * .27, sign.z - .058), identity, matrix, viewport);
        return Array.from(await w.engine.readPixels(Math.round(point.x), w.engine.getRenderHeight() - Math.round(point.y), 1, 1)) as number[];
      }));
    }, sign);
    await page.screenshot({ path: `${output}/${frame.name}.png` });
    assert.ok(pixels.filter(([r, g, b]) => g > r + 3 && g > b).length >= 2, `${frame.name}: visible enamel pixels ${JSON.stringify(pixels)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), browser: browser.version(), exports, errors, scope: 'Actual TownScene and Blender exports; desktop and emulated phone portrait/landscape, normal/performance rendering. No physical-device or multiplayer performance claim.' }, null, 2));
  console.log('PASS: all three casino plaques import, scale, physical mounting clearance, embedded lettering, legacy removal, visible pixels, desktop/mobile and performance-mode captures.', exports);
} finally { await browser.close(); }
