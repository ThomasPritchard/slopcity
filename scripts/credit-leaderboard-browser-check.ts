import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { webkit, type Page } from 'playwright';
import { CREDIT_BOARD } from '../shared/creditLeaderboard.ts';

// Read-only standings check plus one normal local guest; no fixture writes to wallets.
const endpoint = 'http://localhost:5173', output = 'output/playwright/credit-leaderboard';
await mkdir(output, { recursive: true });
const browser = await webkit.launch({ headless: true });
const errors: string[] = [], failures: string[] = [];
let unavailableFixture = false;
async function position(page: Page) {
 await page.getByRole('button', { name: 'Open town map', exact: true }).first().click();
 const map = page.getByRole('dialog', { name: 'Town map', exact: true });
 const marker = map.locator('.town-map circle[fill="#253d33"]');
 const p = { x: Number(await marker.getAttribute('cx')), z: -Number(await marker.getAttribute('cy')) };
 await map.getByRole('button', { name: 'Close panel', exact: true }).click(); return p;
}
async function walk(page: Page, axis: 'x' | 'z', target: number) {
 for (let i = 0; i < 32; i++) {
  const delta = target - (await position(page))[axis]; if (Math.abs(delta) < .3) return;
  const key = axis === 'x' ? delta > 0 ? 'd' : 'a' : delta > 0 ? 'w' : 's';
  await page.locator('#world').focus(); await page.keyboard.down(key);
  await page.waitForTimeout(Math.min(1600, Math.max(65, Math.abs(delta) / 4.2 * 1000)));
  await page.keyboard.up(key); await page.waitForTimeout(180);
 }
 throw new Error(`Walk failed: ${axis}=${target}`);
}
try {
 const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
 await context.addInitScript(() => {
  localStorage.setItem('slop-city-comfort', JSON.stringify({ low: true, motion: 'full', effects: 0, ambience: 0 }));
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw Error('Voice is outside this check'); };
 });
 const page = await context.newPage(); page.setDefaultTimeout(60_000);
 page.on('pageerror', error => errors.push(error.message));
 page.on('response', response => {
  const path = new URL(response.url()).pathname;
  if (response.status() >= 400 && !(response.status() === 401 && path === '/game/api/profile') && !(unavailableFixture && response.status() === 503 && path === '/game/api/economy/leaderboard')) failures.push(`${response.status()} ${path}`);
 });
 await page.goto(endpoint);
 await page.getByRole('textbox', { name: 'WHAT SHOULD WE CALL YOU?' }).fill('Leaderboard check');
 await page.getByRole('button', { name: 'Enter', exact: true }).click({ timeout: 90_000 });
 await page.getByRole('button', { name: 'Join the square', exact: true }).click();
 await page.getByRole('button', { name: 'Open neighbours', exact: true }).waitFor();
 const welcome = page.getByRole('button', { name: 'Dismiss welcome', exact: true }); if (await welcome.isVisible()) await welcome.click();
 for (const [axis, target] of [['x', -4.7], ['z', 11.2], ['x', 0], ['z', 18.25], ['x', 2.8]] as const) await walk(page, axis, target);
 console.log('Walked from the square to reception');
 const snapshot = await page.evaluate(async () => {
  const response = await fetch('/game/api/economy/leaderboard'); if (!response.ok) throw Error('Leaderboard API failed'); return response.json();
 });
 await page.getByRole('button', { name: 'View credit leaderboard', exact: true }).click();
 const panel = page.getByRole('dialog', { name: 'Credit leaderboard', exact: true });
 await panel.locator('tbody tr').first().waitFor();
 assert.equal(await panel.locator('tbody tr').count(), snapshot.entries.length);
 for (let i = 0; i < snapshot.entries.length; i++) {
  const entry = snapshot.entries[i], row = panel.locator('tbody tr').nth(i);
  assert.equal(await row.locator('th').innerText(), entry.name);
  assert.equal(await row.locator('td').last().innerText(), entry.credits.toLocaleString('en-GB'));
 }
 for (const [label, width, height] of [['desktop', 1440, 960], ['portrait', 390, 844], ['landscape', 844, 390]] as const) {
  await page.setViewportSize({ width, height }); await page.waitForTimeout(350);
  const close = await panel.getByRole('button', { name: 'Close credit leaderboard' }).boundingBox();
  assert.ok(close && close.width >= 44 && close.height >= 44 && close.y >= 0 && close.y + close.height <= height);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await panel.locator('tbody tr').last().scrollIntoViewIfNeeded();
  const last = await panel.locator('tbody tr').last().boundingBox(); assert.ok(last && last.y >= 0 && last.y + last.height <= height);
  await panel.locator('tbody tr').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/panel-${label}.png` });
 }
 await page.mouse.click(5, 5); await page.keyboard.press('Escape'); await panel.waitFor({ state: 'detached' });
 await page.setViewportSize({ width: 1440, height: 960 });
 // Frame the actual wall for an actual pointer hit, keeping the player's server position at reception.
 await page.evaluate(async board => {
  const source = await (await fetch('/src/world/scene.ts')).text();
  const path = source.match(/import\s*\{\s*Engine\s*\}\s*from\s*["']([^"']+)/)?.[1];
  if (!path) throw Error('Cannot resolve the renderer');
  const { Engine } = await import(path), scene = Engine.Instances[0].scenes[0], camera = scene.activeCamera;
  (window as any).leaderboardScene = scene;
  (window as any).boardObserver = scene.onBeforeRenderObservable.add(() => {
   camera.setTarget(new camera.target.constructor(board.x, board.y, board.z)); camera.alpha = Math.PI; camera.beta = 1.43; camera.radius = 5.3;
  });
 }, CREDIT_BOARD);
 await page.waitForTimeout(500);
 await page.screenshot({ path: `${output}/live-reception.png` });
 await page.mouse.click(720, 480); await panel.waitFor();
 console.log('Actual wall screen opens the reading panel');
 await page.evaluate(() => { const w = window as any; w.leaderboardScene.onBeforeRenderObservable.remove(w.boardObserver); });
 unavailableFixture = true;
 await page.route('**/game/api/economy/leaderboard', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
 await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
 await panel.getByText('Updates are delayed. Showing the last available standings.', { exact: true }).waitFor();
 assert.equal(await panel.locator('tbody tr').count(), snapshot.entries.length);
 await page.unroute('**/game/api/economy/leaderboard'); unavailableFixture = false;
 await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
 await panel.getByText('Updates every 30 seconds. Poker hands count when settled.', { exact: true }).waitFor();
 // A changed API response drives the real scene's frame loop while this player stands at reception.
 const changed = { ...snapshot, updatedAt: Date.now(), entries: snapshot.entries.map((entry: any, i: number) => i === 0 ? { ...entry, name: 'Flip check', credits: entry.credits + 125 } : entry) };
 await page.evaluate(() => {
  const texture = (window as any).leaderboardScene.getMeshByName('Credit leaderboard screen').material.diffuseTexture;
  const update = texture.update.bind(texture); (window as any).flapUploads = 0;
  texture.update = (...args: unknown[]) => { (window as any).flapUploads++; return update(...args); };
 });
 await page.route('**/game/api/economy/leaderboard', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(changed) }));
 await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
 await panel.getByRole('rowheader', { name: 'Flip check', exact: true }).waitFor();
 await page.waitForFunction(() => (window as any).flapUploads > 2, undefined, { timeout: 5000 });
 await page.waitForTimeout(1400);
 const completedUploads = await page.evaluate(() => (window as any).flapUploads);
 await page.waitForTimeout(350); assert.equal(await page.evaluate(() => (window as any).flapUploads), completedUploads, 'Actual animation stops uploading when settled');
 await page.unroute('**/game/api/economy/leaderboard');
 await panel.getByRole('button', { name: 'Close credit leaderboard' }).click(); await panel.waitFor({ state: 'detached' });
 assert.deepEqual(errors, []); assert.deepEqual(failures, []);
 await writeFile(`${output}/browser-results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), entries: snapshot.entries.length, completedUploads, errors, failures, checks: ['actual guest and walk to reception', 'server standings match panel', 'desktop, portrait and short landscape scrolling', 'background click then Escape', 'physical wall click', 'stale snapshot and recovery after simulated 503', 'changed response drives actual split-flap animation and stops at settlement'] }, null, 2));
 console.log('PASS: reception journey, actual rankings, wall click, responsive reading view, focus and stale-data recovery');
} catch (error) {
 for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
 throw error;
} finally { await browser.close(); }
