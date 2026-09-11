import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { GRAPHICS_PRESETS, graphicsPixelRatio, type GraphicsQuality } from '../src/settings/graphics';

// Local renderer fixtures only: no game-server state or synthetic FPS claims.
const output = 'output/playwright/graphics-presets';
await mkdir(output, { recursive: true });
const fixture = `${output}/runtime.html`;
await writeFile(fixture, `<!doctype html><style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas><script type="module">
import {TownScene} from '/src/world/scene.ts';
const w=window.world=new TownScene(document.querySelector('canvas'),'low');
await w.ready;w.enter('local');w.dayCycle.setPreviewPhase(.25);
const players=new Map();
for(let i=0;i<32;i++)players.set(i===0?'local':'neighbour-'+i,{profileId:'guest-'+i,name:'Neighbour '+i,x:i===0?0:(i%8-3.5)*1.3,z:i===0?-12:-10+Math.floor(i/8)*2.5,heading:Math.PI,moving:i%2===1,seatId:'',wave:0,skin:i%5,shirt:i%6,top:'starter-utility',bottoms:'starter-chinos',shoes:'starter-sneakers'});
w.sync(players);w.recenter();w.camera.radius=13;w.camera.beta=1.05;window.ready=true;
</script>`);
const reports = [];
try {
  for (const name of ['chromium', 'webkit'] as const) {
    const browser = await (name === 'chromium' ? chromium.launch({ headless: true, args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] }) : webkit.launch({ headless: true }));
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true });
      page.setDefaultTimeout(120000);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(`http://localhost:5173/${fixture}`);
      await page.waitForFunction(() => !!(window as any).ready);
      const samples: { materials: number; avatars: { lowDetail: boolean }[] }[] = [];
      let originalAppearance: unknown;
      for (const quality of ['low', 'medium', 'high', 'ultra', 'low', 'ultra', 'high'] as GraphicsQuality[]) {
        await page.evaluate(quality => (window as any).world.setQuality(quality), quality);
        // Wait for actual game updates, including the half-second shadow selection,
        // instead of assuming a wall-clock delay implies the GPU rendered frames.
        await page.evaluate(() => {
          const w = (window as any).world, start = w.clock;
          return new Promise<void>(resolve => {
            const observer = w.scene.onAfterRenderObservable.add(() => {
              if (w.clock - start > .8) { w.scene.onAfterRenderObservable.remove(observer); resolve(); }
            });
          });
        });
        const sample = await page.evaluate(() => {
          const w = (window as any).world, s = w.scene, list = w.shadows.getShadowMap().renderList;
          return {
            quality: w.quality,
            render: [w.engine.getRenderWidth(), w.engine.getRenderHeight()],
            shadowSize: w.shadows.mapSize, shadowRefresh: w.shadows.getShadowMap().refreshRate,
            waterSize: w.water.reflectionTexture.getSize().width, waterRefresh: w.water.reflectionTexture.refreshRate,
            refractionSize: w.water.refractionTexture.getSize().width, normalRefresh: w.fountain.normals.refreshRate,
            glow: w.lampLighting.glow.isEnabled,
            grass: w.vegetation.detail.every((m: any) => m.isEnabled()), seeds: w.vegetation.seeds.every((m: any) => m.isEnabled()),
            materials: s.materials.length,
            avatars: [...w.avatars].map(([id, a]: [string, any]) => ({
              id, lowDetail: a.lowDetail, enabled: a.root.isEnabled(), shadow: a.model.meshes.some((m: any) => list.includes(m)),
              roots: s.transformNodes.filter((n: any) => n.name === id).length,
              appearance: a.model.appearanceKey,
              surfaces: [...new Set(a.model.meshes.filter((m: any) => m.isEnabled() && m.material).map((m: any) => JSON.stringify([m.material.name.split('/').pop(), m.material.albedoColor?.asArray()])))].sort(),
            })),
          };
        });
        const budget = GRAPHICS_PRESETS[quality];
        assert.equal(sample.quality, quality);
        assert.deepEqual(sample.render, [Math.floor(390 * graphicsPixelRatio(quality, 3)), Math.floor(844 * graphicsPixelRatio(quality, 3))]);
        assert.equal(sample.shadowSize, budget.shadowSize);
        assert.equal(sample.shadowRefresh, budget.shadowRefresh);
        assert.equal(sample.waterSize, budget.waterSize);
        assert.equal(sample.refractionSize, budget.waterSize);
        assert.equal(sample.waterRefresh, budget.waterRefresh);
        assert.equal(sample.normalRefresh, budget.waterNormalRefresh);
        assert.equal(sample.glow, budget.glow);
        assert.equal(sample.grass, budget.grassDetail);
        assert.equal(sample.seeds, budget.seedDetail);
        assert.equal(sample.avatars.length, 32);
        assert.ok(sample.avatars.every(a => a.enabled && a.roots === 1), 'every player survives switches with one root');
        assert.equal(sample.avatars.find(a => a.id === 'local')!.lowDetail, false);
        assert.equal(sample.avatars.find(a => a.id === 'local')!.shadow, true);
        assert.ok(sample.avatars.filter(a => a.id !== 'local' && a.shadow).length <= budget.shadowNeighbours);
        const appearance = sample.avatars.map(({ id, appearance, surfaces }) => ({ id, appearance, surfaces }));
        if (!originalAppearance) originalAppearance = appearance;
        assert.deepEqual(appearance, originalAppearance, 'LOD swaps preserve outfit surfaces and colours');
        if (samples.length) assert.equal(sample.materials, samples[0].materials, 'switches do not leak character materials');
        samples.push(sample);
      }
      assert.ok(samples[3].avatars.filter(a => !a.lowDetail).length > samples[0].avatars.filter(a => !a.lowDetail).length, 'Ultra retains more detailed neighbours');
      await page.screenshot({ path: `${output}/${name}-crowd-high.png` });
      // Settings can change while water is paused in a table/wardrobe view.
      const water = await page.evaluate(() => {
        const w = (window as any).world;
        w.focusCasino({ id: 'blackjack-1', game: 'blackjack', x: -8, z: 30, name: 'Blackjack' });
        w.setQuality('low');w.setReducedMotion(true);
        const paused = w.water.reflectionTexture.refreshRate;
        w.setQuality('ultra');w.focusCasino(null);
        const restored = { size: w.water.reflectionTexture.getSize().width, rate: w.water.reflectionTexture.refreshRate, normals: w.fountain.normals.refreshRate };
        w.setReducedMotion(false);
        return { paused, restored, movingNormals: w.fountain.normals.refreshRate };
      });
      assert.deepEqual(water, { paused: 0, restored: { size: 512, rate: 1, normals: 0 }, movingNormals: 1 });
      assert.deepEqual(errors, []);
      reports.push({ browser: name, samples, water, errors });
      console.log(`PASS ${name}: all four presets, 32 preserved outfits, local detail, shadow budgets, repeated LOD/material and water restoration.`);
    } finally { await browser.close(); }
  }
  await writeFile(`${output}/runtime-results.json`, JSON.stringify({ scope: 'Headless browsers, DPR3 phone layout, 32 synthetic avatars; not physical-phone or multiplayer capacity evidence', reports }, null, 2));
} finally { await rm(fixture, { force: true }); }
