import { webkit, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { CASINO_ANCHORS, type Card, type CasinoPrivateState } from '../shared/casino.ts';
import { POKER_GEOMETRY, POKER_SEAT_OFFSETS, pokerCardPosition } from '../shared/pokerLayout.ts';
import type { PokerView } from '../shared/poker.ts';

/** Actual town renderer with synthetic projections; this does not establish network privacy. */
const output = 'output/playwright/poker-render';
await mkdir(output, { recursive: true });
const anchor = CASINO_ANCHORS.find(item => item.game === 'poker')!;
const board: Card[] = [{ rank: 'A', suit: 'hearts' }, { rank: 'K', suit: 'clubs' }, { rank: 'Q', suit: 'diamonds' }, { rank: 'J', suit: 'spades' }, { rank: '10', suit: 'hearts' }];
const hole: Card[] = [{ rank: 'A', suit: 'spades' }, { rank: 'A', suit: 'diamonds' }];
const table: PokerView = {
  id: 'poker-1', game: 'poker', roundId: 'renderer-hand', handId: 'renderer-hand', phase: 'river', deadline: 25000,
  button: 0, smallBlindSeat: 1, bigBlindSeat: 2, activeSeat: 3, board, pot: 420, currentBet: 40,
  seats: ['Tom', 'Maya', 'Owen', 'Zara', 'Theo', 'Luna'].map((name, seat) => ({
    seat, player: { profileId: `fixture-${seat}`, name, connected: true }, stack: 500-seat*40,
    bet: 40, committed: 70, state: 'playing', leaving: false, cards: [null, null],
  })), pots: [], winners: [], message: 'Renderer fixture: public backs and one private hand',
};
const privateState: CasinoPrivateState = { rouletteBets: [], poker: { tableId: 'poker-1', escrowId: 'renderer-seat', seat: 0, handId: 'renderer-hand', holeCards: hole, actions: null, canRejoin: false } };
const failures: string[] = [], checks: string[] = [], errors: string[] = [];
function check(name: string, run: () => void) {
  try { run(); checks.push(name); } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const browser = await webkit.launch({ headless: true });

async function viewer() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  // tsx preserves nested function names in serialized evaluate callbacks.
  await page.addInitScript('window.__name = (value) => value;');
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => { errors.push(error.message); console.error(`Poker renderer page error: ${error.message}`); });
  page.on('console', message => { if (message.type() === 'error') console.error(`Poker renderer console: ${message.text()}`); });
  const url = 'http://localhost:5173/poker-render-fixture.html';
  await page.route(url, route => route.fulfill({ contentType: 'text/html', body: `<style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas><script type="module">import{TownScene}from'/src/world/scene.ts';window.world=new TownScene(document.querySelector('canvas'));await world.ready;const Vector3=world.camera.target.constructor;window.V=Vector3;window.M=world.scene.getTransformMatrix().constructor;window.R=world.camera.getForwardRay().constructor;world.mode='playing';world.studio.setEnabled(false);world.dayCycle.setPreviewPhase(.25);world.dayCycle.clock.now=()=>10000;world.setReducedMotion(true);world.camera.setTarget(new Vector3(11.5,2,51.4));world.camera.radius=world.appliedRadius=world.requestedRadius=6.4;world.camera.alpha=-Math.PI/2;world.camera.beta=.64;window.ready=true;</script>` }));
  await page.goto(url);
  try {
    await page.waitForFunction(() => (window as any).ready && (window as any).world.scene.isReady());
  } catch (error) {
    await page.screenshot({ path: `${output}/startup-failure.png` });
    await writeFile(`${output}/startup-failure.json`, JSON.stringify({ errors, page: await page.evaluate(() => ({ ready: (window as any).ready, world: !!(window as any).world, sceneReady: (window as any).world?.scene.isReady(), html: document.body.innerText })) }, null, 2));
    throw error;
  }
  await page.evaluate(() => (window as any).world.engine.stopRenderLoop());
  return page;
}

async function sync(page: Page, value = table, privateValue: CasinoPrivateState = { rouletteBets: [] }) {
  await page.evaluate(({ value, privateValue }) => {
    const w = (window as any).world;
    w.syncCasino({ serverTime: 10000, tables: [value] }); w.syncCasinoPrivate(privateValue); w.scene.render();
  }, { value, privateValue });
  await page.waitForFunction(() => (window as any).world.scene.isReady());
  await page.evaluate(() => (window as any).world.scene.render());
}

async function inspect(page: Page) {
  return page.evaluate(({ anchor, geometry, seats }) => {
    const w = (window as any).world, V = (window as any).V, M = (window as any).M, R = (window as any).R;
    w.scene.render();
    const tableRoot = w.scene.getTransformNodeByName('poker-table-instance');
    const markerNodes = tableRoot.getChildTransformNodes().filter((n: any) => /\/(felt-origin|community-card-\d|hole-seat-\d-card-\d)$/.test(n.name));
    const markers = Object.fromEntries(markerNodes.map((n: any) => { n.computeWorldMatrix(true); return [n.name.split('/').pop(), n.getAbsolutePosition().asArray()]; }));
    const vertices = (mesh: any) => {
      mesh.computeWorldMatrix(true); const raw = mesh.getVerticesData('position'), result: number[][] = [];
      for (let i = 0; i < raw.length; i += 3) result.push(V.TransformCoordinates(V.FromArray(raw, i), mesh.getWorldMatrix()).asArray());
      return result;
    };
    const bounds = (points: number[][]) => [
      [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis]))),
      [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis]))),
    ];
    const surface = (point: number[]) => {
      const hit = w.scene.pickWithRay(new R(new V(point[0], 2.6, point[2]), new V(0, -1, 0), 1.2), (mesh: any) => mesh.name.startsWith('poker-table/') && mesh.getTotalVertices() > 0);
      return hit?.hit ? { height: hit.pickedPoint.y, material: hit.pickedMesh.material.name } : null;
    };
    const width = w.engine.getRenderWidth(), height = w.engine.getRenderHeight(), v = w.camera.viewport;
    const viewport = { x: v.x*width, y: (1-v.y-v.height)*height, width: v.width*width, height: v.height*height };
    const project = (point: number[]) => V.Project(V.FromArray(point), M.Identity(), w.scene.getTransformMatrix(), viewport).asArray();
    const cards = Array.from({ length: 17 }, (_, index) => {
      const mesh = w.scene.getMeshByName(`poker-live/card-${index}`), corners = vertices(mesh);
      const texture = mesh.material.diffuseTexture, ctx = texture.getContext(), pixels = ctx.getImageData(0, 0, texture.getSize().width, texture.getSize().height).data;
      let hash = 2166136261; for (const byte of pixels) { hash ^= byte; hash = Math.imul(hash, 16777619); }
      return { index, enabled: mesh.isEnabled(), material: mesh.material.name, position: mesh.position.asArray() as number[], heading: mesh.rotation.y, corners, surfaces: corners.map(surface), screen: corners.map(project), textureHash: hash >>> 0 };
    });
    const chips: { name: string; enabled: boolean; bounds: number[][]; position: number[] }[] = w.scene.meshes.filter((mesh: any) => /^poker-live\/(stack-|bet-|pot-chips)/.test(mesh.name)).map((mesh: any) => ({ name: mesh.name, enabled: mesh.isEnabled(), bounds: bounds(vertices(mesh)), position: mesh.position.asArray() }));
    const chairs = seats.map((seat: any) => {
      const roots = w.scene.transformNodes.filter((n: any) => n.name === 'casino-chair-instance' && Math.hypot(n.position.x-anchor.x-seat.x, n.position.z-anchor.z-seat.z) < .001);
      if (roots.length !== 1) return { count: roots.length, position: null, heading: null, contact: null };
      const root = roots[0], contact = root.getChildTransformNodes().find((n: any) => n.name.endsWith('/chair-seat-contact'));
      root.computeWorldMatrix(true); contact?.computeWorldMatrix(true);
      return { count: roots.length, position: root.position.asArray(), heading: root.rotation.y, contact: contact?.getAbsolutePosition().asArray() ?? null };
    });
    const tableVertices = tableRoot.getChildMeshes().filter((m: any) => m.getTotalVertices() > 0).flatMap(vertices);
    const tableScreen = bounds(tableVertices.filter((p: number[]) => p[1] >= 1.95).map(project));
    const labels: { name: string; enabled: boolean; position: number[]; bounds: number[][]; screen: number[][] }[] = w.scene.meshes.filter((m: any) => /^poker-live\/(seat-|pot$|dealer-button)/.test(m.name)).map((m: any) => ({ name: m.name, enabled: m.isEnabled(), position: m.position.asArray(), bounds: bounds(vertices(m)), screen: vertices(m).map(project) }));
    const pokerMeshes = w.scene.meshes.filter((m: any) => /^(poker-table|poker-live)\//.test(m.name) && m.getTotalVertices() > 0);
    const lights = w.scene.lights.filter((l: any) => /^(Meridian interior fill|Meridian marquee light|Lamp post light)/.test(l.name)).map((l: any) => ({ name: l.name, allPokerIncluded: pokerMeshes.every((m: any) => l.includedOnlyMeshes.includes(m)), allPokerExcluded: pokerMeshes.every((m: any) => l.excludedMeshes.includes(m)) }));
    return { markers, cards, chips, chairs, labels, lights, viewport, tableScreen, tablePosition: tableRoot.position.asArray(), tableRotation: tableRoot.rotation.y, geometry, camera: { radius: w.camera.radius, alpha: w.camera.alpha, beta: w.camera.beta, target: w.camera.target.asArray() } };
  }, { anchor, geometry: POKER_GEOMETRY, seats: POKER_SEAT_OFFSETS });
}

type Inspection = Awaited<ReturnType<typeof inspect>>;
function withinViewport(points: number[][], result: Inspection) {
  const v = result.viewport;
  return points.every(([x, y, depth]) => depth >= 0 && depth <= 1 && x >= v.x-1 && x <= v.x+v.width+1 && y >= v.y-1 && y <= v.y+v.height+1);
}

try {
  const owner = await viewer();
  await sync(owner, table, privateState);
  await owner.screenshot({ path: `${output}/table-owner.png` });
  console.log(`Rendered ${output}/table-owner.png`);
  const owned = await inspect(owner);
  const spectator = await viewer(); await sync(spectator);
  await spectator.screenshot({ path: `${output}/table-spectator.png` });
  const publicView = await inspect(spectator);
  check('Owner sees only their private pair', () => {
    assert.deepEqual(owned.cards.slice(5, 7).map(c => c.material), hole.map(c => `Poker card ${c.rank}-${c.suit}`));
    assert.ok(owned.cards.slice(7).every(c => c.enabled && c.material === 'Poker card back'));
    assert.ok(publicView.cards.slice(5).every(c => c.enabled && c.material === 'Poker card back'));
    assert.notEqual(owned.cards[5].textureHash, publicView.cards[5].textureHash);
    assert.deepEqual(owned.cards.slice(7).map(c => c.textureHash), publicView.cards.slice(7).map(c => c.textureHash));
  });
  check('Five public board materials agree across viewers', () => {
    assert.deepEqual(owned.cards.slice(0, 5).map(c => c.material), board.map(c => `Poker card ${c.rank}-${c.suit}`));
    assert.deepEqual(owned.cards.slice(0, 5).map(c => c.textureHash), publicView.cards.slice(0, 5).map(c => c.textureHash));
    assert.equal(new Set(owned.cards.slice(0, 5).map(c => c.textureHash)).size, 5);
  });
  check('Authored table and source markers match the pinned layout', () => {
    assert.deepEqual(owned.tablePosition, [anchor.x, .9, anchor.z]); assert.ok(Math.abs(owned.tableRotation-Math.PI) < 1e-6);
    assert.ok(Math.abs(owned.markers['felt-origin'][1]-2) < 1e-5);
    for (const card of owned.cards) {
      const key = card.index < 5 ? `community-card-${card.index}` : `hole-seat-${Math.floor((card.index-5)/2)}-card-${(card.index-5)%2}`;
      assert.ok(card.position.every((value, axis) => Math.abs(value-owned.markers[key][axis]) < 1e-5), key);
      if (card.index >= 5) {
        const pose = pokerCardPosition(Math.floor((card.index-5)/2), (card.index-5)%2);
        assert.ok(Math.abs(card.heading-pose.heading) < 1e-6, key);
      }
    }
  });
  check('All 17 cards clear the actual imported felt and padded rail', () => {
    for (const card of owned.cards) for (const [index, corner] of card.corners.entries()) {
      const surface = card.surfaces[index];
      assert.ok(surface && /gaming felt/.test(surface.material), `Card ${card.index} corner ${index} lies above ${surface?.material ?? 'empty space'}`);
      assert.ok(Math.abs(surface!.height-2) < 1e-4 && corner[1] >= surface!.height+.005, `Card ${card.index} felt clearance`);
    }
  });
  check('Six authored chair roots and seat contacts align', () => {
    for (const [index, chair] of owned.chairs.entries()) {
      const seat = POKER_SEAT_OFFSETS[index]; assert.equal(chair.count, 1);
      assert.ok(Math.abs(chair.heading!-(Math.PI+seat.heading)) < 1e-5);
      assert.ok(chair.contact && Math.abs(chair.contact[0]-anchor.x-seat.x) < 1e-5 && Math.abs(chair.contact[2]-anchor.z-seat.z) < 1e-5 && Math.abs(chair.contact[1]-1.4425) < 1e-5);
    }
  });
  check('Six stacks, six bets, pot and dealer are visible', () => {
    assert.equal(owned.chips.filter(c => c.enabled).length, 13);
    assert.ok(owned.labels.find(l => l.name === 'poker-live/dealer-button')?.enabled);
    for (const chip of owned.chips) assert.ok(chip.bounds.every(p => p[1] >= 2.014), `${chip.name} penetrates felt`);
  });
  check('Pot label clears every chip footprint, including the north bet', () => {
    const pot = owned.labels.find(label => label.name === 'poker-live/pot')!;
    for (const chip of owned.chips.filter(chip => chip.enabled)) {
      const overlapX = Math.min(pot.bounds[1][0], chip.bounds[1][0])-Math.max(pot.bounds[0][0], chip.bounds[0][0]);
      const overlapZ = Math.min(pot.bounds[1][2], chip.bounds[1][2])-Math.max(pot.bounds[0][2], chip.bounds[0][2]);
      assert.ok(overlapX <= 0 || overlapZ <= 0, `${chip.name} covers the pot label`);
    }
  });
  check('Venue lights include poker and square lights exclude it', () => {
    for (const light of owned.lights) assert.ok(light.name.startsWith('Meridian interior fill') ? light.allPokerIncluded : light.allPokerExcluded, light.name);
  });
  await sync(owner, table, { ...privateState, poker: { ...privateState.poker!, handId: 'older-hand' } });
  const stale = await inspect(owner);
  check('Stale private hand cannot reveal the current public backs', () => assert.ok(stale.cards.slice(5).every(c => c.material === 'Poker card back')));
  const showdown: PokerView = { ...table, phase: 'result', activeSeat: null, seats: table.seats.map((seat, i) => ({ ...seat, cards: i === 1 ? [{ rank: 'K', suit: 'hearts' }, { rank: 'K', suit: 'spades' }] : seat.cards })) };
  await sync(spectator, showdown); const revealed = await inspect(spectator);
  check('Spectators reveal only the public showdown cards', () => {
    assert.deepEqual(revealed.cards.slice(7, 9).map(c => c.material), ['Poker card K-hearts', 'Poker card K-spades']);
    assert.ok(revealed.cards.slice(5, 7).concat(revealed.cards.slice(9)).every(c => c.material === 'Poker card back'));
    assert.equal(revealed.chips.filter(c => c.enabled).length, 6);
  });
  await sync(owner, table, privateState);
  const framing = [];
  for (const [name, width, height] of [['desktop', 1280, 850], ['portrait', 390, 844], ['landscape', 844, 390]] as const) {
    await owner.setViewportSize({ width, height });
    await owner.evaluate(anchor => { const w = (window as any).world; w.setQuality(innerWidth < 900); w.focusCasino(anchor); for (let i = 0; i < 8; i++) w.scene.render(); }, anchor);
    await sync(owner, table, privateState);
    await owner.screenshot({ path: `${output}/focus-${name}.png` });
    const result = await inspect(owner); framing.push({ name, ...result });
    check(`${name}: all cards fit the actual casino viewport`, () => assert.ok(withinViewport(result.cards.flatMap(c => c.screen), result), JSON.stringify({ viewport: result.viewport, camera: result.camera })));
    check(`${name}: complete padded tabletop fits the actual casino viewport`, () => assert.ok(withinViewport(result.tableScreen, result), JSON.stringify({ viewport: result.viewport, camera: result.camera })));
  }
  check('No page errors', () => assert.deepEqual(errors, []));
  await writeFile(`${output}/renderer-results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), browser: browser.version(), scope: 'Actual TownScene and PokerTableArt with synthetic public/private projections; not a network, server privacy or physical-device test.', checks, failures, errors, owned, publicView, stale, revealed, framing }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, failures }, null, 2));
  assert.deepEqual(failures, [], 'Poker renderer assertions');
} finally { await browser.close(); }
