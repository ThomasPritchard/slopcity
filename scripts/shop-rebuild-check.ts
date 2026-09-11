import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { SHOP_LAYOUT, SHOP_PREVIEW, SHOP_SIGNS, SHOP_WALLS, SHOP_FURNITURE, shopPoint } from '../shared/shopLayout.ts';

const output = 'output/playwright/shop-rebuild';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors: string[] = [], captures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(90000);
  await page.addInitScript('window.__name = (value) => value;');
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  const url = 'http://localhost:5173/shop-rebuild-fixture.html';
  await page.route(url, route => route.fulfill({ contentType: 'text/html', body: `<style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas><script type="module">import{TownScene}from'/src/world/scene.ts';window.world=new TownScene(document.querySelector('canvas'));await world.ready;world.mode='playing';world.studio.setEnabled(false);world.dayCycle.setPreviewPhase(.25);world.setReducedMotion(true);window.ready=true;</script>` }));
  await page.goto(url);
  await page.waitForFunction(() => (window as any).ready && (window as any).world.scene.isReady());
  await page.evaluate(() => (window as any).world.engine.stopRenderLoop());
  const imported = await page.evaluate(() => {
    const w = (window as any).world;
    w.scene.render();
    const assets = ['form-thread-shell', 'form-thread-roof', 'clothing-shop'].map(name => {
      const root = w.scene.getTransformNodeByName(`${name}-instance`);
      root.computeWorldMatrix(true);
      const bounds = root.getHierarchyBoundingVectors();
      const markers = Object.fromEntries(root.getChildTransformNodes().filter((n: any) => n.name.includes('/shop-')).map((node: any) => {
        node.computeWorldMatrix(true); return [node.name.split('/').pop(), node.getAbsolutePosition().asArray()];
      }));
      return { name, position: root.position.asArray(), rotation: root.rotation.y, bounds: { min: bounds.min.asArray(), max: bounds.max.asArray() }, markers,
        meshes: root.getChildMeshes().filter((m: any) => m.getTotalVertices() > 0).map((m: any) => ({ name: m.name, material: m.material?.name, enabled: m.isEnabled(), triangles: m.getTotalIndices()/3 })) };
    });
    const mannequins = [1,2,3,4].map(i => {
      const root = w.scene.getTransformNodeByName(`shop-mannequin-${i}`);
      return { position: root.position.asArray(), heading: root.rotation.y, models: [...new Set(root.getChildMeshes().filter((m: any) => m.isEnabled()).map((m: any) => /wear_([a-z]+)__/.exec(m.material?.name)?.[1]).filter(Boolean))] };
    });
    return { assets, mannequins, mirrorPlane: w.shopMirror.mirrorPlane.asArray(), mirrorMeshes: w.scene.meshes.filter((m: any) => m.material?.name === 'Fitting room mirror').length,
      lights: w.scene.lights.filter((l: any) => l.name.startsWith('Form & Thread')).map((l: any) => ({ name: l.name, count: l.includedOnlyMeshes.length, spills: l.includedOnlyMeshes.some((m: any) => m.name.startsWith('meridian-') || m.name.startsWith('town-ground/')) })) };
  });
  const near = (actual: number[], expected: number[], name: string) => assert.ok(actual.length === expected.length && actual.every((v, i) => Math.abs(v - expected[i]) < .0001), `${name}: ${actual} != ${expected}`);
  const vector = (p: ReturnType<typeof shopPoint>) => [p.x, p.y, p.z];
  for (const asset of imported.assets) {
    near(asset.position, vector(shopPoint(0,0)), asset.name);
    for (const [marker, pos] of [['origin', [0,0,0]], ['axis-right', [1,0,0]], ['axis-depth', [0,1,0]], ['axis-up', [0,0,1]]] as const) near(asset.markers[`shop-${marker}`], vector(shopPoint(pos[0],pos[1],pos[2])), `${asset.name}/${marker}`);
    assert.ok(asset.meshes.length > 0 && asset.meshes.every((m: any) => m.enabled));
    assert.ok(asset.meshes.length <= 24 && asset.meshes.reduce((n: number, m: any) => n + m.triangles, 0) < 100000);
  }
  const interior = imported.assets.find(a => a.name === 'clothing-shop')!;
  near(interior.markers['shop-fitting-center-1'], vector(SHOP_PREVIEW), 'fitting anchor');
  near(imported.assets[0].markers['shop-fascia-sign-anchor'], vector(SHOP_SIGNS.fascia), 'fascia');
  near(interior.markers['shop-tagline-sign-anchor'], vector(SHOP_SIGNS.tagline), 'tagline');
  assert.equal(imported.mirrorMeshes, 1, 'two coplanar mirrors share one material batch');
  near(imported.mirrorPlane, [1,0,0,-33.518], 'mirror plane');
  assert.equal(imported.lights.length, 3); assert.ok(imported.lights.every((l: { count: number; spills: boolean }) => l.count > 30 && !l.spills));
  for (const [i, look] of SHOP_LAYOUT.mannequins.entries()) {
    near(imported.mannequins[i].position, vector(shopPoint(look.x,look.y,look.height)), `mannequin ${i+1}`);
    assert.equal(imported.mannequins[i].models.length, 3, 'one visible garment per slot');
  }
  for (const frame of [
    { name: 'exterior-day', target: [24,2,-2], radius: 21, alpha: Math.PI+.14, beta: 1.42, phase: .25 },
    { name: 'arrival-day', target: [28,1.65,-2], radius: 9, alpha: Math.PI, beta: 1.47, phase: .25 },
    { name: 'department-day', target: [26.3,1.55,4.1], radius: 5.7, alpha: Math.PI-.14, beta: 1.48, phase: .25 },
    { name: 'checkout-day', target: [31.3,1.7,4.4], radius: 4.8, alpha: Math.PI+.12, beta: 1.48, phase: .25 },
    { name: 'arrival-night', target: [28,1.65,-2], radius: 9, alpha: Math.PI, beta: 1.47, phase: .75 },
    { name: 'exterior-night', target: [24,2,-2], radius: 21, alpha: Math.PI+.14, beta: 1.42, phase: .75 },
  ]) {
    await page.evaluate(frame => { const w = (window as any).world, V = w.camera.target.constructor; w.dayCycle.setPreviewPhase(frame.phase); w.camera.setTarget(V.FromArray(frame.target)); w.camera.alpha=frame.alpha;w.camera.beta=frame.beta;w.camera.radius=frame.radius;w.scene.render(); }, frame);
    await page.waitForFunction(() => (window as any).world.scene.isReady());
    await page.evaluate(() => (window as any).world.scene.render());
    await page.screenshot({ path: `${output}/${frame.name}.png` }); captures.push(frame.name);
  }
  for (const [name, width, height, low] of [['desktop',1440,960,false],['portrait',390,844,true],['landscape',844,390,true]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(low => { const w=(window as any).world;w.setQuality(low);w.customise({name:'Shop fitting check',shirt:0,skin:1,top:'oat-knit',bottoms:'sand-chinos',shoes:'brown-loafers'},true,true);w.scene.render(); }, low);
    await page.waitForFunction(() => (window as any).world.scene.isReady());
    for (const view of ['outfit','shoes'] as const) {
      await page.evaluate(view => { const w=(window as any).world;w.framePreview(view); for(let i=0;i<20;i++)w.scene.render(); }, view);
      await page.screenshot({ path: `${output}/fitting-${view}-${name}.png` });
      const fitting = await page.evaluate(() => {
        const w=(window as any).world;
        return { position:w.preview.root.position.asArray(), reflectionHasPreview:w.shopMirror.renderList.includes(w.preview.meshes[0]), roofEnabled:w.scene.getTransformNodeByName('form-thread-roof-instance').isEnabled(), viewport:[w.camera.viewport.x,w.camera.viewport.y,w.camera.viewport.width,w.camera.viewport.height] };
      });
      near(fitting.position, vector(SHOP_PREVIEW), `preview ${name}`);assert.ok(fitting.reflectionHasPreview);assert.ok(fitting.roofEnabled);
      captures.push({ name:`fitting-${view}-${name}`, ...fitting });
    }
  }
  const orbit = await page.evaluate(() => {
    const w=(window as any).world,c=w.camera, result=[];
    w.framePreview('outfit');
    for (const alpha of [c.lowerAlphaLimit,c.upperAlphaLimit]) for(const beta of [c.lowerBetaLimit,c.upperBetaLimit]) {
      c.alpha=alpha;c.beta=beta;c.radius=c.upperRadiusLimit;w.scene.render();result.push(c.position.asArray());
    }
    return result as number[][];
  });
  for (const [x,y,z] of orbit) {
    assert.ok(y>.15 && y<4.43,'fitting orbit clears floor and ceiling');
    assert.ok(![...SHOP_WALLS,...SHOP_FURNITURE].some(b=>Math.abs(x-b.x)<b.w/2+.08&&Math.abs(z-b.z)<b.d/2+.08&&y<b.h+.08),'fitting orbit clears walls and clothes rails');
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/renderer-results.json`, JSON.stringify({ checkedAt:new Date().toISOString(), browser:browser.version(), scope:'Actual TownScene with maintained exports, controlled renderer views and emulated layouts; no server interaction or physical-device performance claim.', imported,captures,errors },null,2));
  console.log(`PASS: imported axes, anchors, mirror plane, four catalogue mannequins, bounded light membership, asset budgets and ${captures.length} actual renderer captures.`);
} finally { await browser.close(); }
