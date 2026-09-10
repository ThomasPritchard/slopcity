import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { BENCHES, SEATS } from '../shared/social.ts';

// Renderer-only fixture: no guest credentials, sockets or database state.
const endpoint = process.env.GAME_URL || 'http://localhost:5173';
const kind = process.env.BROWSER === 'webkit' ? 'webkit' : 'chromium';
const output = `output/playwright/benches/${kind}`;
await mkdir(output, { recursive: true });
const bytes = await readFile('public/models/bench.glb');
assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
const triangles = gltf.meshes.reduce((n: number, m: any) => n + m.primitives.reduce((n: number, p: any) => n + gltf.accessors[p.indices].count / 3, 0), 0);
assert.ok(triangles < 16_000 && bytes.length < 1_000_000, 'bounded street-furniture export');
assert.equal(gltf.meshes.length, 5);
assert.equal(gltf.images.length, 1, 'one embedded original timber texture');
assert.ok(gltf.images[0].bufferView !== undefined && !gltf.images[0].uri);
for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
  if (/oak/.test(gltf.materials[primitive.material].name)) assert.ok('TEXCOORD_0' in primitive.attributes);
}
const browser = await (kind === 'webkit' ? webkit : chromium).launch({ headless: true });
const errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(60_000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  const fixture = `${endpoint}/benches-check-fixture.html`;
  await page.route(fixture, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas tabindex="0"></canvas><script type="module">
    import {TownScene} from '/src/world/scene.ts';
    const w = new TownScene(document.querySelector('canvas')); window.w = w; await w.ready;
    w.dayCycle.setPreviewPhase(.25); w.setReducedMotion(true);
    // Only the inspection camera is pinned; citizen animation uses TownScene.sync/update.
    w.scene.onBeforeRenderObservable.add(() => {
      if (!window.view) return;
      const [x,y,z,alpha,beta,radius] = window.view;
      w.camera.setTarget(new w.camera.target.constructor(x,y,z));
      w.camera.alpha=alpha; w.camera.beta=beta; w.camera.radius=radius;
      for (const avatar of w.avatars.values()) avatar.label.visibility=0;
    });
    window.ready = true;
  </script>` }));
  await page.goto(fixture);
  await page.waitForFunction(() => (window as any).ready && (window as any).w.scene.isReady());
  console.log('Bench renderer ready');
  const placements = await page.evaluate(() => {
    const w = (window as any).w;
    return w.scene.transformNodes.filter((n: any) => n.name === 'bench-instance').map((root: any) => {
      root.computeWorldMatrix(true);
      const meshes = root.getChildMeshes().filter((m: any) => m.getTotalVertices());
      for (const mesh of meshes) mesh.computeWorldMatrix(true);
      const min = [0, 1, 2].map(axis => Math.min(...meshes.map((m: any) => m.getBoundingInfo().boundingBox.minimumWorld.asArray()[axis])));
      const max = [0, 1, 2].map(axis => Math.max(...meshes.map((m: any) => m.getBoundingInfo().boundingBox.maximumWorld.asArray()[axis])));
      return { position: root.position.asArray(), heading: root.rotation.y, meshes: meshes.length, min, max };
    });
  });
  assert.equal(placements.length, BENCHES.length);
  for (const bench of BENCHES) {
    const placed = placements.find((p: any) => p.position[0] === bench.x && p.position[2] === bench.z)!;
    assert.deepEqual(placed.position, [bench.x, 0, bench.z]);
    assert.equal(placed.heading, bench.heading);
    assert.equal(placed.meshes, 5);
    const axis = Math.abs(Math.cos(bench.heading)) > .5 ? 0 : 2;
    assert.ok(Math.abs(placed.max[axis] - placed.min[axis] - 2.35) < .001);
    assert.ok(Math.abs(placed.min[1]) < .001 && placed.max[1] > 1 && placed.max[1] < 1.1);
  }
  const aim = async (index: number, alphaOffset = .42, radius = 5, beta = 1.2, y = .62) => {
    const bench = BENCHES[index];
    await page.evaluate(view => { (window as any).view = view; }, [bench.x, y, bench.z, Math.PI / 2 - bench.heading + alphaOffset, beta, radius]);
    await page.waitForFunction(() => (window as any).w.scene.isReady());
    await page.waitForTimeout(350);
  };
  const visibility = [];
  for (const low of [false, true]) {
    await page.evaluate(low => (window as any).w.setQuality(low), low);
    for (let index = 0; index < BENCHES.length; index++) {
      await aim(index);
      await page.evaluate(async bench => {
        const w = (window as any).w;
        const root = w.scene.transformNodes.find((n: any) => n.name === 'bench-instance' && n.position.x === bench.x && n.position.z === bench.z);
        (window as any).wood = root.getChildMeshes().filter((m: any) => /Bench .*oak/.test(m.material?.name));
        (window as any).before = await w.engine.readPixels(0, 0, w.engine.getRenderWidth(), w.engine.getRenderHeight());
        for (const mesh of (window as any).wood) mesh.setEnabled(false);
      }, BENCHES[index]);
      await page.waitForTimeout(250);
      const pixels = await page.evaluate(async () => {
        const w = (window as any).w, a = (window as any).before;
        const b = await w.engine.readPixels(0, 0, w.engine.getRenderWidth(), w.engine.getRenderHeight());
        let changed = 0;
        for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i+1] - b[i+1]) + Math.abs(a[i+2] - b[i+2]) > 15) changed++;
        for (const mesh of (window as any).wood) mesh.setEnabled(true);
        return changed;
      });
      assert.ok(pixels > 1000, `bench ${index}, performance=${low}: visible timber pixels ${pixels}`);
      visibility.push({ id: BENCHES[index].id, low, pixels });
      console.log(`Bench ${BENCHES[index].id}, performance=${low}: ${pixels} timber pixels`);
      if (!low) { await page.waitForTimeout(250); await page.screenshot({ path: `${output}/${BENCHES[index].id}.png` }); }
    }
  }
  await page.evaluate(() => (window as any).w.setQuality(false));
  await aim(2, .42, 4.5); await page.screenshot({ path: `${output}/bench.png` });
  await aim(2, Math.PI + .4, 4.5); await page.screenshot({ path: `${output}/rear.png` });
  await aim(2, .85, 2.7, 1.15, .45); await page.screenshot({ path: `${output}/joinery.png` });
  // All eight authored anchors use the actual citizen rig and its existing Sit clip.
  await page.evaluate(seats => {
    const w = (window as any).w;
    const players = new Map(seats.map((seat, i) => [seat.id, {
      ...seat, name: '', profileId: 'fixture', seatId: seat.id, moving: false, wave: 0,
      skin: i % 3, shirt: i % 4, top: 'starter-utility', bottoms: 'starter-chinos', shoes: 'starter-sneakers',
    }]));
    (window as any).players = players;
    w.enter(seats[4].id); w.sync(players);
  }, SEATS);
  await page.waitForTimeout(1200);
  const seated = await page.evaluate(() => {
    const w = (window as any).w;
    return [...w.avatars.entries()].map(([id, avatar]: any) => ({ id, position: avatar.root.position.asArray(), heading: avatar.root.rotation.y,
      sit: avatar.model.entries.animationGroups.some((g: any) => g.name.endsWith('/Sit') && g.isStarted),
    }));
  });
  for (const seat of SEATS) {
    const avatar = seated.find((a: any) => a.id === seat.id)!;
    assert.deepEqual(avatar.position, [seat.x, 0, seat.z]);
    assert.equal(avatar.heading, seat.heading); assert.ok(avatar.sit, `${seat.id} uses the actual Sit clip`);
  }
  await aim(2, .42, 4.8); await page.screenshot({ path: `${output}/seated-front.png` });
  await aim(2, 1.5, 4.4, 1.43); await page.screenshot({ path: `${output}/seated-side.png` });
  await aim(2, Math.PI + .4, 4.8); await page.screenshot({ path: `${output}/seated-rear.png` });
  await page.locator('canvas').focus(); await page.keyboard.down('w'); await page.waitForTimeout(350); await page.keyboard.up('w');
  assert.deepEqual(await page.evaluate(() => (window as any).w.avatars.get('south-west-1').root.position.asArray()), [SEATS[4].x, 0, SEATS[4].z], 'seated input cannot move the citizen');
  await page.evaluate(seat => {
    const w = (window as any).w, players = (window as any).players;
    players.set(seat.id, { ...players.get(seat.id), ...seat.exit, seatId: '' }); w.sync(players);
  }, SEATS[4]);
  await page.waitForTimeout(600);
  const standing = await page.evaluate(() => {
    const avatar = (window as any).w.avatars.get('south-west-1');
    return { position: avatar.root.position.asArray(), idle: avatar.model.entries.animationGroups.some((g: any) => g.name.endsWith('/Idle') && g.isPlaying), sit: avatar.model.entries.animationGroups.some((g: any) => g.name.endsWith('/Sit') && g.isStarted) };
  });
  assert.deepEqual(standing.position, [SEATS[4].exit.x, 0, SEATS[4].exit.z]);
  assert.ok(standing.idle && !standing.sit, 'standing restores Idle at the existing exit');
  await aim(2, .42, 5.5); await page.screenshot({ path: `${output}/standing.png` });
  await page.evaluate(() => { const w = (window as any).w; w.sync(new Map()); w.dayCycle.setPreviewPhase(.75); });
  await aim(2, .42, 5); await page.screenshot({ path: `${output}/night.png` });
  await page.evaluate(() => (window as any).w.dayCycle.setPreviewPhase(.25));
  for (const [name, width, height, radius] of [['phone-portrait', 390, 844, 8], ['phone-landscape', 844, 390, 5]] as const) {
    await page.setViewportSize({ width, height }); await page.evaluate(() => (window as any).w.setQuality(true));
    await aim(2, .42, radius);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/${name}.png` });
  }
  await page.evaluate(() => (window as any).w.setQuality(false));
  await page.waitForTimeout(500); assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), browser: browser.version(), triangles, bytes: bytes.length, placements, visibility, seated, standing, errors,
    scope: 'Actual bench export and TownScene with synthetic player snapshots. All four models, eight Sit anchors, movement suppression, stand transition, day/night and normal/performance captures. Headless desktop/emulated phone; no network or physical-device performance claim.' }, null, 2));
  console.log('PASS: all benches visible, seating anchors/Sit/stand preserved, day/night and normal/performance, desktop/emulated phone; no browser errors.');
} finally { await browser.close(); }
