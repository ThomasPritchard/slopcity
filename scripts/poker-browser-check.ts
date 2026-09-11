import { webkit, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { POKER_DEFAULT_BUY_IN } from '../shared/poker.ts';
import { POKER_SEAT_OFFSETS } from '../shared/pokerLayout.ts';

// Actual local game journey. Two fresh cookie jars; no injected game or wallet state.
const output = 'output/playwright/poker-browser';
await mkdir(output, { recursive: true });
const browser = await webkit.launch({ headless: true });
const errors: string[] = [], shots: string[] = [];
const navigations: { player: string; at: string; path: string }[] = [];
const players: { page: Page; name: string; seat: number; before: number; afterBuyIn: number }[] = [];
const actions: { name: string; phase: string; action: string }[] = [];
const cardEvidence: unknown[] = [], seatEvidence: unknown[] = [], layouts: unknown[] = [];
const phase = (page: Page) => page.locator('.poker-game').getAttribute('data-phase');
const wallet = (page: Page) => page.evaluate(async () => {
  const response = await fetch('/game/api/economy');
  if (!response.ok) throw new Error(`Wallet read failed: ${response.status}`);
  const value = await response.json();
  return { balance: value.balance as number, revision: value.revision as number };
});

async function position(page: Page) {
  await page.getByRole('button', { name: 'Open town map', exact: true }).first().click();
  const map = page.getByRole('dialog', { name: 'Town map', exact: true });
  const mark = map.locator('.town-map circle[fill="#253d33"]');
  const value = { x: Number(await mark.getAttribute('cx')), z: -Number(await mark.getAttribute('cy')) };
  await map.getByRole('button', { name: 'Close panel', exact: true }).click();
  return value;
}

async function walk(page: Page, axis: 'x' | 'z', target: number) {
  for (let attempt = 0; attempt < 32; attempt++) {
    const delta = target - (await position(page))[axis];
    if (Math.abs(delta) < .3) return;
    const key = axis === 'x' ? delta > 0 ? 'd' : 'a' : delta > 0 ? 'w' : 's';
    await page.locator('#world').focus();
    await page.keyboard.down(key);
    await page.waitForTimeout(Math.min(1600, Math.max(65, Math.abs(delta) / 4.2 * 1000)));
    await page.keyboard.up(key);
    await page.waitForTimeout(180);
  }
  throw new Error(`Walking did not reach ${axis}=${target}; position=${JSON.stringify(await position(page))}`);
}

async function screenshot(page: Page, name: string) {
  await page.waitForFunction(() => {
    const camera = (window as any).casinoScene?.activeCamera;
    return camera && camera.viewport.y === (innerWidth < 700 && innerHeight > innerWidth ? .55 : 0);
  });
  await page.waitForTimeout(180);
  const path = `${output}/${name}.png`;
  await page.screenshot({ path }); shots.push(path);
}

async function arrive(name: string, seat: number) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, hasTouch: true });
  // Voice is never enabled by this journey. Any accidental capture request receives synthetic silence.
  await context.addInitScript(() => {
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext(), source = audio.createOscillator(), gain = audio.createGain(), destination = audio.createMediaStreamDestination();
      gain.gain.value = 0; source.connect(gain); gain.connect(destination); source.start();
      return destination.stream;
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push({ player: name, at: new Date().toISOString(), path: new URL(frame.url()).pathname }); });
  const player = { page, name, seat, before: 0, afterBuyIn: 0 }; players.push(player);
  await page.goto('http://localhost:5173');
  await page.getByRole('textbox', { name: 'WHAT SHOULD WE CALL YOU?' }).fill(name);
  await page.getByRole('button', { name: 'Enter', exact: true }).click({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Join the square', exact: true }).click();
  await page.getByRole('button', { name: 'Open town map', exact: true }).first().waitFor();
  const welcome = page.getByRole('button', { name: 'Dismiss welcome', exact: true });
  if (await welcome.isVisible()) await welcome.click();
  await page.evaluate(async () => {
    const path = '/node_modules/.vite/deps/@babylonjs_core_Engines_engine.js';
    const { Engine } = await import(path);
    (window as any).casinoScene = Engine.Instances[0].scenes[0];
  });
  console.log(`${name} joined the town.`);
  for (const [axis, target] of [['x', -4.7], ['z', 11.2], ['x', 0], ['z', 26.7], ['x', 12], ['z', 48], ['x', 11.5], ['z', 49.4]] as const) {
    await walk(page, axis, target);
    if (axis === 'z' && target === 26.7) console.log(`${name} crossed the foyer and stairs.`);
  }
  await page.getByRole('button', { name: 'Open Texas Hold’em', exact: true }).click();
  await page.locator('.poker-game').waitFor();
  player.before = (await wallet(page)).balance;
  console.log(`${name} reached poker through the square, foyer, stairs and right aisle.`);
  return player;
}

async function avatar(page: Page, name: string) {
  return page.evaluate(name => {
    const scene = (window as any).casinoScene, root = scene.getMeshByName(`sign-${name}`)?.parent;
    if (!root) return null;
    return { position: root.position.asArray() as number[], heading: root.rotation.y as number, sitting: scene.animationGroups.some((group: any) => group.name === `${root.name}/Sit` && group.isPlaying) };
  }, name);
}

function cardLabel(material: string) {
  const match = /^Poker card (A|K|Q|J|10|[2-9])-(clubs|diamonds|hearts|spades)$/.exec(material);
  assert.ok(match, `Recognisable physical card material: ${material}`);
  const rank: Record<string, string> = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack' };
  return `${rank[match[1]] ?? match[1]} of ${match[2]}`;
}

async function verifyCards(player: typeof players[number], showdown = false) {
  const { page, seat, name } = player, otherSeat = seat === 0 ? 3 : 0;
  const physical = await page.evaluate(() => {
    const scene = (window as any).casinoScene;
    return Array.from({ length: 17 }, (_, index) => {
      const mesh = scene.getMeshByName(`poker-live/card-${index}`);
      return { index, enabled: !!mesh?.isEnabled(), material: mesh?.material?.name as string };
    });
  });
  const ownUI = await page.locator('.poker-own-hand .poker-card:visible, .poker-dock-cards .poker-card:visible').evaluateAll(cards => cards.map(card => card.getAttribute('aria-label')));
  assert.equal(ownUI.length, 2, `${name}: two private cards in the UI`);
  assert.deepEqual(physical.slice(5 + seat * 2, 7 + seat * 2).map(card => { assert.ok(card.enabled); return cardLabel(card.material); }), ownUI, `${name}: private UI cards match physical faces`);
  const otherUI = await page.locator('.poker-seats > .poker-seat').nth(otherSeat).locator('.poker-card').evaluateAll(cards => cards.map(card => card.getAttribute('aria-label')));
  const otherPhysical = physical.slice(5 + otherSeat * 2, 7 + otherSeat * 2);
  assert.ok(otherPhysical.every(card => card.enabled));
  if (showdown) assert.deepEqual(otherPhysical.map(card => cardLabel(card.material)), otherUI, `${name}: opponent showdown faces match`);
  else {
    assert.deepEqual(otherUI, ['Face-down card', 'Face-down card']);
    assert.deepEqual(otherPhysical.map(card => card.material), ['Poker card back', 'Poker card back'], `${name}: opponent physical cards remain concealed`);
  }
  const boardUI = await page.locator('.poker-board-cards .poker-card:not(.is-empty)').evaluateAll(cards => cards.map(card => card.getAttribute('aria-label')));
  assert.deepEqual(physical.slice(0, 5).filter(card => card.enabled).map(card => cardLabel(card.material)), boardUI, `${name}: community UI cards match physical faces`);
  cardEvidence.push({ player: name, phase: await phase(page), own: ownUI, opponent: otherUI, board: boardUI, physical });
  return boardUI;
}

async function mobile(player: typeof players[number]) {
  const { page, name } = player;
  for (const [orientation, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]] as const) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(200);
    await page.locator('.casino-body').evaluate(body => { body.scrollTop = 0; });
    const controls = page.locator('.poker-action-dock button, .casino-header .casino-leave');
    assert.ok(await controls.count() >= 3, `${orientation}: active poker controls rendered`);
    const boxes = [];
    for (const control of await controls.all()) {
      const box = await control.boundingBox();
      assert.ok(box && box.height >= 44 && box.y >= 0 && box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width, `${orientation}: ${await control.innerText()} stays visible at least 44px high`);
      boxes.push({ action: await control.innerText(), box });
    }
    const privateCards = page.locator('.poker-dock-cards .poker-card');
    assert.equal(await privateCards.count(), 2);
    for (const card of await privateCards.all()) {
      const box = await card.boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= viewport.height, `${orientation}: private cards stay visible`);
    }
    const body = await page.locator('.casino-body').boundingBox();
    for (const card of await page.locator('.poker-board-cards .poker-card').all()) {
      const box = await card.boundingBox();
      assert.ok(body && box && box.y >= body.y && box.y + box.height <= body.y + body.height, `${orientation}: community cards stay fully visible above the dock and receipt footer; body=${JSON.stringify(body)}, card=${JSON.stringify(box)}`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    layouts.push({ player: name, orientation, viewport, boxes });
    await screenshot(page, orientation);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForTimeout(100);
}

try {
  const a = await arrive('Poker browser A', 0), b = await arrive('Poker browser B', 3);
  for (const player of players) {
    await player.page.getByRole('button', { name: `Select seat ${player.seat + 1}`, exact: true }).click();
    await player.page.getByRole('button', { name: `Join seat ${player.seat + 1}`, exact: true }).click();
    await player.page.getByRole('button', { name: 'Leave seat', exact: true }).waitFor();
    player.afterBuyIn = (await wallet(player.page)).balance;
    assert.equal(player.afterBuyIn, player.before - POKER_DEFAULT_BUY_IN, `${player.name}: wallet buy-in debit`);
  }
  await a.page.locator('.poker-game[data-phase="preflop"]').waitFor();
  await b.page.locator('.poker-game[data-phase="preflop"]').waitFor();
  await a.page.waitForTimeout(250);
  for (const viewer of players) for (const player of players) {
    const value = await avatar(viewer.page, player.name), offset = POKER_SEAT_OFFSETS[player.seat];
    assert.ok(value && Math.abs(value.position[0] - (11.5 + offset.x)) < .02 && Math.abs(value.position[2] - (51.4 + offset.z)) < .02, `${viewer.name}: ${player.name} occupies the physical chair`);
    assert.equal(value.sitting, true, `${viewer.name}: seated animation plays`);
    seatEvidence.push({ viewer: viewer.name, player: player.name, state: 'seated', ...value });
  }
  await verifyCards(a); await verifyCards(b);
  await a.page.locator('.casino-body').evaluate(body => { body.scrollTop = 0; });
  await screenshot(a.page, 'desktop-private');
  const active = await a.page.locator('.poker-basic-actions').count() ? a : b;
  await mobile(active);
  console.log('Both buy-ins debited; private/hidden 3D cards, seated avatars and mobile controls verified.');

  const visited = new Set<string>(), handLimit = Date.now() + 120_000;
  while (await phase(a.page) !== 'result' && Date.now() < handLimit) {
    const current = await phase(a.page);
    if (current && !visited.has(current) && ['preflop', 'flop', 'turn', 'river'].includes(current)) {
      await b.page.locator(`.poker-game[data-phase="${current}"]`).waitFor();
      assert.deepEqual(await verifyCards(a), await verifyCards(b), `Shared ${current} board matches both clients`);
      visited.add(current);
      if (current === 'flop') { await a.page.locator('.casino-body').evaluate(body => { body.scrollTop = 0; }); await screenshot(a.page, 'desktop-flop'); }
    }
    let acted = false;
    for (const player of players) {
      const check = player.page.getByRole('button', { name: 'Check', exact: true });
      const call = player.page.getByRole('button', { name: /^Call [\d,]+ chips$/ });
      const button = await check.count() && await check.isEnabled() ? check : await call.count() && await call.isEnabled() ? call : null;
      if (!button) continue;
      const action = await button.innerText();
      actions.push({ name: player.name, phase: (await phase(player.page))!, action });
      await button.click(); acted = true;
      await player.page.waitForTimeout(140);
      break;
    }
    if (!acted) await a.page.waitForTimeout(100);
  }
  await a.page.locator('.poker-game[data-phase="result"]').waitFor({ timeout: 5000 });
  await b.page.locator('.poker-game[data-phase="result"]').waitFor({ timeout: 5000 });
  assert.ok(actions.some(action => action.action.startsWith('Call ')) && actions.some(action => action.action === 'Check'), 'Actual call and check actions were accepted through the UI');
  assert.deepEqual([...visited], ['preflop', 'flop', 'turn', 'river']);
  assert.deepEqual(await verifyCards(a, true), await verifyCards(b, true));
  const winners = await a.page.locator('.poker-winners').innerText();
  assert.equal(await b.page.locator('.poker-winners').innerText(), winners);
  const stacks = await Promise.all(players.map(async player => Number((await player.page.locator('.poker-seat.is-yours .poker-seat-stack').innerText()).replace(/[^0-9]/g, ''))));
  assert.equal(stacks.reduce((sum, stack) => sum + stack, 0), POKER_DEFAULT_BUY_IN * 2, 'Combined table chips conserved');
  for (const player of players) assert.equal((await wallet(player.page)).balance, player.afterBuyIn, 'Hand winnings remain in table chips until cash-out');
  await a.page.locator('.poker-results').scrollIntoViewIfNeeded();
  await screenshot(a.page, 'desktop-showdown');
  await a.page.getByRole('button', { name: 'Leave seat', exact: true }).click();
  // The world exit must remain usable with a full-width portrait chat panel open.
  await b.page.getByRole('button', { name: 'Close casino table', exact: true }).click();
  const chat = b.page.getByRole('button', { name: 'Toggle town chat', exact: true });
  if (await chat.getAttribute('aria-pressed') !== 'true') await chat.click();
  await b.page.setViewportSize({ width: 390, height: 844 });
  await b.page.waitForTimeout(200);
  await b.page.screenshot({ path: `${output}/world-exit-portrait-chat.png` });
  await b.page.getByRole('button', { name: 'Leave seat', exact: true }).click();
  await b.page.locator('.casino-seat-action').waitFor({ state: 'detached' });
  await b.page.setViewportSize({ width: 1440, height: 960 });
  const finalBalances = [];
  for (const [index, player] of players.entries()) {
    await player.page.locator('.casino-panel').waitFor({ state: 'detached' });
    const balance = (await wallet(player.page)).balance;
    assert.equal(balance, player.afterBuyIn + stacks[index], `${player.name}: table stack returned to wallet`);
    finalBalances.push(balance);
    await player.page.waitForTimeout(250);
    const value = await avatar(player.page, player.name), offset = POKER_SEAT_OFFSETS[player.seat];
    assert.ok(value && Math.abs(value.position[0] - (11.5 + offset.exitX)) < .02 && Math.abs(value.position[2] - (51.4 + offset.exitZ)) < .02, 'Avatar released to the outside of its chair');
    assert.equal(value.sitting, false, 'Seated animation released');
    seatEvidence.push({ viewer: player.name, player: player.name, state: 'released', ...value });
    const before = await position(player.page);
    await player.page.locator('#world').focus(); await player.page.keyboard.down(player.seat === 0 ? 's' : 'w'); await player.page.waitForTimeout(220); await player.page.keyboard.up(player.seat === 0 ? 's' : 'w'); await player.page.waitForTimeout(180);
    assert.ok(Math.hypot((await position(player.page)).x - before.x, (await position(player.page)).z - before.z) > .15, 'Released avatar can walk away');
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), browser: 'headless WebKit', contexts: 2, actualApp: true, routes: 'Town square, foyer, stairs, right aisle, poker', actions, winners, initialBalances: players.map(player => player.before), afterBuyIn: players.map(player => player.afterBuyIn), finalStacks: stacks, finalBalances, cardEvidence, seatEvidence, layouts, screenshots: shots, errors, limits: 'Local full-app browser gameplay with synthetic-only capture fallback. Emulated phone layouts do not establish physical phone performance. Voice media was not tested.' }, null, 2));
  console.log('PASS: two independent browsers walked to poker, bought in, checked/called through showdown, matched UI and physical cards, conserved/cashed-out chips and left their chairs.');
} catch (error) {
  for (const [index, player] of players.entries()) {
    console.log(`${player.name}: ${(await player.page.locator('body').innerText()).slice(-3500)}`);
    await player.page.screenshot({ path: `${output}/failure-${index}.png` }).catch(() => {});
  }
  await writeFile(`${output}/failure.json`, JSON.stringify({ checkedAt: new Date().toISOString(), error: String(error), errors, navigations, actions, cardEvidence, seatEvidence, layouts }, null, 2));
  throw error;
} finally {
  for (const player of players) {
    const leave = player.page.getByRole('button', { name: 'Leave seat', exact: true });
    if (await leave.isVisible().catch(() => false) && await leave.isEnabled().catch(() => false)) await leave.click({ timeout: 2000 }).catch(() => {});
  }
  await browser.close();
}
