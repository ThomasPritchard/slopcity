import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { preview } from 'vite';
import { chromium, webkit, type Page, type Browser } from 'playwright';
import WebSocket from 'ws';
import type { Room } from '@colyseus/sdk';
import type { TownState } from '../shared/state.ts';
import type { ChatMessage } from '../shared/chat.ts';

// Serve the built release, including minified CSS, against an isolated local database.
loadEnvFile('.env');
const url = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
const schema = `hud_chat_${randomUUID().replaceAll('-', '')}`, admin = new Pool({ connectionString: url.toString() });
url.searchParams.set('options', `-c search_path=${schema}`);
const endpoint = 'http://127.0.0.1:2582', site = 'http://localhost:5182';
const kind = process.env.HUD_BROWSER || 'brave', output = `output/playwright/hud-qol/${kind}`;
await mkdir(output, { recursive: true }); await admin.query(`CREATE SCHEMA ${schema}`);
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '2582', APP_ORIGIN: site, APP_ORIGINS: '', TURNSTILE_ENABLED: 'false', DATABASE_URL: url.toString(), TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '' }, stdio: 'ignore' });
let web: Awaited<ReturnType<typeof preview>> | undefined, browser: Browser | undefined;
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
const { Client } = await import('@colyseus/sdk');
const rooms: Room<unknown, TownState>[] = [], errors: string[] = [], failures: string[] = [], checks: string[] = [];
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 20000) { const start = Date.now(); while (!await check()) { if (Date.now() - start > timeout) throw new Error(`Timed out: ${label}`); await delay(50); } }
async function join(page: Page, name: string) {
  page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { const path = new URL(response.url()).pathname; if (response.status() >= 400 && !(response.status() === 401 && path === '/game/api/profile')) failures.push(`${response.status()} ${path}`); });
  await page.addInitScript(() => { localStorage.setItem('slop-city-comfort', JSON.stringify({ graphics: 'medium', motion: 'reduced', effects: 0, ambience: 0 })); });
  await page.goto(site); await page.getByRole('textbox', { name: 'WHAT SHOULD WE CALL YOU?' }).fill(name);
  await page.getByRole('button', { name: 'Enter', exact: true }).click({ timeout: 90000 });
  await page.getByRole('button', { name: 'Join the square', exact: true }).click({ timeout: 90000 });
  await page.getByRole('button', { name: 'Open neighbours', exact: true }).waitFor();
  const welcome = page.getByRole('button', { name: 'Dismiss welcome' }); if (await welcome.isVisible()) await welcome.click();
  return await page.evaluate(async () => (await (await fetch('/game/api/profile')).json()).id as string);
}
async function raw(name: string) {
  const response = await fetch(`${endpoint}/api/guest`, { method: 'POST', headers: { Origin: site, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, shirt: 1, skin: 2 }) }); assert.equal(response.status, 201);
  const profile = await response.json(), cookie = response.headers.get('set-cookie')!.split(';')[0];
  const room = await new Client(endpoint, { headers: { Cookie: cookie, Origin: site } }).joinOrCreate<TownState>('town'); rooms.push(room);
  const messages: ChatMessage[] = []; room.onMessage<ChatMessage>('chat', message => messages.push(message));
  for (const type of ['chat-error', 'voice-neighbours', 'notice', 'economy', 'casino-state', 'casino-private', 'casino-receipt', 'emote-inbox']) room.onMessage(type, () => {});
  return { room, profile, messages };
}
async function fits(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox(), viewport = page.viewportSize()!;
  assert.ok(box && box.width > 50 && box.height > 30 && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${selector} fits ${viewport.width}x${viewport.height}: ${JSON.stringify(box)}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}
async function dialogVisible(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name, exact: true }); await dialog.waitFor();
  assert.equal(await dialog.evaluate(node => node.matches(':modal')), true, 'native top layer');
  await fits(page, 'dialog[open]');
  assert.equal(await dialog.evaluate(node => { const box = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); }), true, 'dialog receives hit tests above game');
}
try {
  await until(async () => { try { return (await fetch(`${endpoint}/health`)).ok; } catch { return false; } }, 'isolated server');
  web = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 5182, strictPort: true, proxy: { '/game': { target: endpoint, ws: true, rewrite: path => path.replace(/^\/game/, '') } } } });
  browser = await (kind === 'webkit' ? webkit : chromium).launch({ headless: true, ...(kind === 'brave' ? { executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' } : {}), ...(kind !== 'webkit' && process.platform === 'darwin' ? { args: ['--use-angle=metal'] } : {}) });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } }); const page = await context.newPage();
  const ownId = await join(page, 'Rowan'), bea = await raw('Bea'), ada = await raw('Ada');
  await until(() => bea.room.state?.players?.size === 3, 'three real guests');
  await page.getByRole('button', { name: 'Open neighbours', exact: true }).click(); await dialogVisible(page, 'Your neighbours.');
  await page.screenshot({ path: `${output}/social-desktop.png` });
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Open neighbours', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.getByRole('button', { name: 'Open neighbours', exact: true }).click();
  await page.getByRole('button', { name: 'View Bea', exact: true }).click(); await dialogVisible(page, 'Bea');
  await page.screenshot({ path: `${output}/player-card-desktop.png` });
  await page.getByRole('button', { name: 'Whisper to Bea', exact: true }).click();
  const whisper = page.getByRole('textbox', { name: 'Whisper message' }); await whisper.fill('Meet me by the fountain'); await whisper.press('Enter');
  await until(() => bea.messages.some(message => message.body === 'Meet me by the fountain'), 'UI whisper delivery'); assert.ok(!ada.messages.some(message => message.body === 'Meet me by the fountain'));
  assert.equal(await page.locator('.chat-destination').textContent(), 'Whisper to Bea');
  bea.room.send('chat', { channel: 'whisper', toProfileId: ownId, body: 'See you there, Rowan' });
  await page.locator('.chat-history').getByText('See you there, Rowan', { exact: true }).waitFor();
  await delay(1100); await page.keyboard.press('Enter'); await whisper.fill('/r Bring your lucky jacket'); await whisper.press('Enter');
  await until(() => bea.messages.some(message => message.body === 'Bring your lucky jacket'), 'reply shortcut');
  await page.getByRole('button', { name: 'Town', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message to town' }); await input.fill('/w "Ada" Hello privately'); await delay(2200); await input.press('Enter');
  await until(() => ada.messages.some(message => message.body === 'Hello privately'), 'quoted name command'); assert.ok(!bea.messages.some(message => message.body === 'Hello privately'));
  await page.getByRole('button', { name: 'Town', exact: true }).click();
  for (let n = 0; n < 16; n++) { const peer = n % 2 ? bea : ada; peer.room.send('chat', `Neighbourhood note ${n + 1}: good company in the square today.`); await delay(1100); }
  await page.locator('.chat-history').getByText('Neighbourhood note 16: good company in the square today.', { exact: true }).waitFor();
  const metrics = await page.locator('.chat-history').evaluate(node => ({ height: node.clientHeight, total: node.scrollHeight, font: getComputedStyle(node.querySelector('p')!).fontSize })); assert.ok(metrics.height >= 180 && metrics.total > metrics.height); assert.equal(metrics.font, '14px');
  await page.locator('.chat-history').evaluate(node => { node.scrollTop = 0; }); await delay(150);
  await delay(2200); bea.room.send('chat', 'A new note while you read'); await page.locator('.chat-history').getByText('A new note while you read', { exact: true }).waitFor();
  assert.ok(await page.locator('.chat-history').evaluate(node => node.scrollTop < 10), 'incoming messages preserve scrollback');
  await page.getByRole('button', { name: /Jump to latest/ }).click();
  await until(async () => await page.getByRole('button', { name: 'Town', exact: true }).count() === 1, 'active channel unread clears');
  await page.screenshot({ path: `${output}/hud-1080p.png` });
  await page.getByRole('button', { name: 'Close town chat', exact: true }).click();
  await delay(2200); bea.room.send('chat', { channel: 'whisper', toProfileId: ownId, body: 'A quiet hello in your closed chat' });
  await page.locator('.toolbar-chat-badge').waitFor();
  await page.keyboard.press('Enter'); await input.waitFor();
  assert.equal(await page.locator('.chat-destination').textContent(), 'Town', 'incoming whisper never retargets composer');
  await page.getByRole('button', { name: /Whispers/ }).click(); await page.locator('.chat-history').getByText('A quiet hello in your closed chat', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('button', { name: 'Expand chat height' }).click(); assert.ok((await page.locator('.chat-panel').boundingBox())!.height > 400);
  await page.getByRole('button', { name: 'Change chat text size' }).click(); assert.equal(await page.locator('.chat-history p').first().evaluate(node => getComputedStyle(node).fontSize), '16px');
  await page.setViewportSize({ width: 3840, height: 2160 }); await fits(page, '.bottom-left'); await fits(page, '.toolbar');
  assert.ok((await page.getByRole('button', { name: 'Open neighbours', exact: true }).boundingBox())!.width >= 60);
  await page.screenshot({ path: `${output}/hud-4k.png` });
  await page.setViewportSize({ width: 1920, height: 1080 });
  checks.push('production bundle; Social/player top layer and focus; private UI whispers and /w /r; 1080p/4K HUD; timestamps; scrollback/unread; height/font controls');
  // Move through real server-owned movement to the leaderboard and roulette table.
  const position = () => [...bea.room.state.players.values()].find(player => player.profileId === ownId)!;
  async function walk(axis: 'x' | 'z', target: number) { for (let n = 0; n < 55; n++) { const delta = target - position()[axis]; if (Math.abs(delta) < .28) return; const key = axis === 'x' ? delta > 0 ? 'd' : 'a' : delta > 0 ? 'w' : 's'; await page.locator('#world').focus(); await page.keyboard.down(key); await delay(Math.min(1000, Math.max(55, Math.abs(delta) / 4.2 * 1000))); await page.keyboard.up(key); await delay(160); } throw new Error(`walk ${axis} ${target}`); }
  for (const [axis, target] of [['x', -4.7], ['z', 11.2], ['x', 0], ['z', 18.25], ['x', 2.8]] as const) await walk(axis, target);
  await page.getByRole('button', { name: 'View credit leaderboard', exact: true }).click(); await dialogVisible(page, 'Credit leaderboard');
  for (const [label, width, height] of [['desktop', 1920, 1080], ['portrait', 390, 844], ['landscape', 844, 390]] as const) { await page.setViewportSize({ width, height }); await fits(page, 'dialog[open]'); await page.screenshot({ path: `${output}/leaderboard-${label}.png` }); }
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0);
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const [axis, target] of [['x', 0], ['z', 29.8]] as const) await walk(axis, target);
  await page.getByRole('button', { name: 'Open European roulette · Table 1', exact: true }).click();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  const tableInput = page.getByRole('textbox', { name: 'Message to table' }); await tableInput.fill('Good luck at our table'); await tableInput.press('Enter');
  await page.locator('.chat-history').getByText('Good luck at our table', { exact: true }).waitFor(); assert.ok(!bea.messages.some(message => message.body === 'Good luck at our table'));
  for (const [label, width, height] of [['desktop', 1920, 1080], ['portrait', 390, 844], ['landscape', 844, 390]] as const) { await page.setViewportSize({ width, height }); await fits(page, '.casino-chat'); await fits(page, '.casino-panel'); await page.screenshot({ path: `${output}/table-chat-${label}.png` }); assert.ok(await page.locator('.chat-history').evaluate(node => node.clientHeight >= 30)); }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Whispers', exact: true }).click();
  await page.getByRole('combobox', { name: 'Whisper recipient' }).selectOption(bea.profile.id);
  await fits(page, '.chat-compose-row');
  assert.ok(await page.locator('.chat-history').evaluate(node => node.clientHeight >= 30), 'portrait casino whisper keeps visible history');
  const composer = page.getByRole('textbox', { name: 'Whisper message' });
  assert.equal(await composer.evaluate(node => { const b = node.getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === node; }), true, 'whisper input is not clipped');
  assert.ok((await page.getByRole('button', { name: 'Close town chat', exact: true }).boundingBox())!.height >= 44);
  await page.screenshot({ path: `${output}/table-whisper-portrait.png` });
  checks.push('actual walk and leaderboard at three sizes; actual roulette table chat, outsider exclusion, portrait/landscape fit');
  await context.close();
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: kind !== 'webkit' }); const phone = await touch.newPage();
  await join(phone, 'Poppy');
  assert.equal(await phone.locator('.chat-panel').count(), 0, 'touch chat starts collapsed');
  assert.equal(await phone.locator('.toolbar').evaluate(node => getComputedStyle(node).transform), 'none', 'no desktop scaling on touch');
  await phone.getByRole('button', { name: 'Toggle town chat' }).click(); await fits(phone, '.chat-panel');
  assert.ok((await phone.getByRole('textbox', { name: 'Message to town' }).boundingBox())!.height >= 44);
  await phone.screenshot({ path: `${output}/touch-portrait.png` });
  await phone.setViewportSize({ width: 844, height: 390 }); await fits(phone, '.chat-panel'); await phone.screenshot({ path: `${output}/touch-landscape.png` });
  await phone.getByRole('button', { name: 'Close town chat', exact: true }).click();
  await phone.setViewportSize({ width: 1024, height: 1366 }); assert.equal(await phone.locator('.toolbar').evaluate(node => getComputedStyle(node).transform), 'none');
  await phone.getByRole('button', { name: 'Open neighbours', exact: true }).click(); await dialogVisible(phone, 'Your neighbours.');
  await phone.screenshot({ path: `${output}/touch-tablet.png` }); await touch.close();
  checks.push('touch portrait/landscape/tablet preserve HUD scale and 44px composer; native Social on tablet');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  await writeFile(`${output}/result.json`, JSON.stringify({ checkedAt: new Date().toISOString(), browser: kind, version: browser.version(), checks, errors, failures }, null, 2));
  console.log(`PASS ${kind}: ${checks.join('; ')}`);
} catch (error) {
  for (const context of browser?.contexts() || []) for (const page of context.pages()) await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser?.close(); await Promise.allSettled(rooms.map(room => room.leave())); await web?.close();
  server.kill('SIGTERM'); await until(() => server.exitCode !== null || server.signalCode !== null, 'server exit');
  await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
}
