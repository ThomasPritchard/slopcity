import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { Pool } from 'pg';
import WebSocket from 'ws';
import { chromium, webkit, type Page } from 'playwright';
import type { TownState } from '../shared/state.ts';
import type { PrivateGuestProfile } from '../shared/profile.ts';

// Headless end-to-end check for chat moderation: an isolated game server (own database schema)
// plus a worktree vite instance proxy /game to it, then a real browser drives the chat panel
// while a raw Colyseus client probes server-side enforcement from a second guest.
loadEnvFile('.env');
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
const { Client } = await import('@colyseus/sdk');
const port = Number(process.env.TEST_CHAT_PORT || 2577), endpoint = `http://127.0.0.1:${port}`;
const site = process.env.TEST_CHAT_SITE || 'http://localhost:5176';
const output = 'output/playwright';
await mkdir(output, { recursive: true });
const schema = `chat_browser_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const isolated = new URL(process.env.DATABASE_URL!);
isolated.searchParams.set('options', `-c search_path=${schema}`);
const database = new Pool({ connectionString: isolated.toString() });
await admin.query(`CREATE SCHEMA ${schema}`);
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, PORT: String(port), DATABASE_URL: isolated.toString(), APP_ORIGIN: site }, stdio: ['ignore', 'pipe', 'pipe'],
});
// Third-party error output may include connection strings; keep child output private.
server.stdout.resume(); server.stderr.resume();
const vite = await (await import('vite')).createServer({
  root: process.cwd(), cacheDir: 'output/playwright/chat-vite-cache', logLevel: 'error', optimizeDeps: { force: true },
  server: { host: '127.0.0.1', port: 5176, strictPort: true, proxy: {
    '/game': { target: endpoint, ws: true, rewrite: (path: string) => path.replace(/^\/game/, '') },
    '/voice': { target: 'http://127.0.0.1:17880', ws: true, rewrite: (path: string) => path.replace(/^\/voice/, '') },
  } },
});
await vite.listen();
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 8000) {
  const start = performance.now();
  while (!(await check())) {
    if (performance.now() - start > timeout) throw new Error(`Timed out: ${label}`);
    await delay(30);
  }
}
async function guest(name: string) {
  const response = await fetch(`${endpoint}/api/guest`, { method: 'POST', headers: { Origin: site, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, shirt: 1, skin: 2 }) });
  assert.equal(response.status, 201);
  return { cookie: response.headers.get('set-cookie')!.split(';')[0], profile: await response.json() as PrivateGuestProfile };
}
const browser = await (process.env.CHAT_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.CHAT_BROWSER !== 'webkit' && process.platform === 'darwin' ? { args: ['--use-angle=metal'] } : {}) });
try {
  await until(async () => { try { return (await fetch(`${endpoint}/health`)).ok; } catch { return false; } }, 'isolated server health');
  await until(async () => { try { return (await fetch(site)).ok; } catch { return false; } }, 'worktree vite serving');
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('same key')) errors.push(message.text()); });
  await page.goto(site);
  await page.getByRole('textbox', { name: 'WHAT SHOULD WE CALL YOU?' }).fill('Chat Tester');
  await page.getByRole('button', { name: 'Enter', exact: true }).click();
  await page.getByRole('button', { name: 'Join the square', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Join the square', exact: true }).click();
  await page.getByRole('button', { name: 'Open town map' }).waitFor();
  await page.waitForTimeout(900);
  const input = page.getByLabel('Message to town');
  const history = (text: string) => page.locator('.chat-history p', { hasText: text });
  async function send(body: string) { await input.fill(body, { force: true }); await page.getByRole('button', { name: 'Send message' }).click({ force: true }); await delay(1000); }

  // Plain and mild-swearing messages go through.
  await send('hello town');
  await until(async () => (await history('hello town').count()) > 0, 'plain message delivered');
  await send('fuck this deadline');
  await until(async () => (await history('fuck this deadline').count()) > 0, 'mild swearing delivered');
  console.log('PASS: plain chat and allowed mild swearing are delivered.');

  // Client-side block keeps the draft and explains itself with a local [SYSTEM] chat line.
  await input.fill('call him a n1gg3r');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.waitForTimeout(400);
  assert.ok((await page.locator('.chat-history .chat-system', { hasText: 'Extreme profanity' }).count()) > 0, 'profanity system line shown');
  assert.equal(await history('n1gg3r').count(), 0, 'blocked profanity never enters history');
  assert.ok((await input.inputValue()).includes('n1gg3r'), 'draft preserved for editing');
  await input.fill('see bit.ly/slopcity');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.waitForTimeout(400);
  assert.ok((await page.locator('.chat-history .chat-system', { hasText: "Links can't be posted" }).count()) > 0, 'url system line shown');
  assert.equal(await history('bit.ly').count(), 0, 'blocked link never enters history');
  await page.screenshot({ path: `${output}/11-chat-notice.png` });
  await input.fill('');
  await send('see you at the fountain');
  await until(async () => (await history('see you at the fountain').count()) > 0, 'chat recovers after blocks');
  console.log('PASS: client-side blocks show notices, keep the draft and never post.');

  // A raw Colyseus guest probes server-side enforcement (modified-client behaviour).
  const ruby = await guest('Raw Ruby');
  const rawNotices: string[] = []; let rawSilence = 0;
  const raw = await new Client(endpoint, { headers: { Cookie: ruby.cookie, Origin: site } }).joinOrCreate<TownState>('town');
  raw.onMessage<string>('notice', text => rawNotices.push(text));
  raw.onMessage<{ seconds?: number }>('silenced', value => { rawSilence = Math.max(rawSilence, value?.seconds ?? 0); });
  await until(() => (raw.state?.players?.size ?? 0) === 2, 'raw client joined the town');
  await delay(900); raw.send('chat', 'raw hello from ruby');
  await until(async () => (await history('raw hello from ruby').count()) > 0, 'raw plain message reaches the browser');
  await delay(900); raw.send('chat', 'you absolute faggot');
  await until(() => rawNotices.some(text => text.includes("isn't welcome")), 'server rejects slur');
  assert.equal(await history('faggot').count(), 0, 'raw slur never reaches the browser');
  await delay(900); raw.send('chat', 'visit example.com for coins');
  await until(() => rawNotices.some(text => text.includes('Links aren')), 'server rejects link');
  assert.equal(await history('example.com').count(), 0, 'raw link never reaches the browser');
  await delay(900);
  raw.send('chat', 'same same');
  await delay(900);
  raw.send('chat', 'same same');
  await until(() => rawNotices.some(text => text.includes('repeat of your last message')), 'duplicate dropped without strike');
  console.log('PASS: server blocks slurs, links and duplicates even for raw clients.');

  // Raw guest floods: third offence triggers the escalating silence.
  for (let n = 0; n < 6; n++) { raw.send('chat', `ruby burst ${n}`); await delay(950); }
  await until(() => rawSilence > 0, 'raw flood escalates to silence', 15000);
  raw.send('chat', 'one more try');
  await until(() => rawNotices.some(text => /Silenced/i.test(text)) || rawSilence > 0, 'silenced raw guest rejected');
  console.log(`PASS: server silences the raw flooder (${rawSilence}s).`);

  // Browser-side enforcement under a modified client: a second browser guest with the client
  // pre-check stubbed out sends link messages straight through the UI. The server blocks each one,
  // three offences escalate to silence, and the badge + disabled input appear — pacing-independent
  // (headless software rendering makes each UI send take seconds, too slow to trip the flood window).
  const stubbed = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await stubbed.route('**/shared/moderation.ts*', async route => {
    // Replace only chat admission; preserve the exports used by profile validation.
    const response = await route.fetch(), source = await response.text();
    assert.ok(source.includes('export function checkChat('));
    const body = source.replace('export function checkChat(', 'function originalCheckChat(') + '\nexport function checkChat() { return { ok: true }; }\n';
    await route.fulfill({ response, body });
  });
  const second = await stubbed.newPage();
  second.on('pageerror', error => errors.push(error.message));
  second.on('console', message => { if (message.type() === 'error' && message.text().includes('same key')) errors.push(message.text()); });
  await second.goto(site);
  await second.getByRole('textbox', { name: 'WHAT SHOULD WE CALL YOU?' }).fill('Silent Sam');
  await second.getByRole('button', { name: 'Enter', exact: true }).click();
  await second.getByRole('button', { name: 'Join the square', exact: true }).waitFor();
  await second.getByRole('button', { name: 'Join the square', exact: true }).click();
  await second.getByRole('button', { name: 'Open town map' }).waitFor();
  await second.waitForTimeout(900);
  const secondInput = second.getByLabel('Message to town');
  const secondHistory = (text: string) => second.locator('.chat-history p', { hasText: text });
  for (let n = 0; n < 3; n++) {
    await secondInput.fill(`coins at bit.ly/slop-${n}`, { force: true });
    await second.getByRole('button', { name: 'Send message' }).click({ force: true });
    await delay(1200);
  }
  assert.equal(await secondHistory('bit.ly').count(), 0, 'server dropped every link message');
  assert.ok((await second.locator('.chat-history .chat-system', { hasText: "Links can't be posted" }).count()) > 0, 'server url notice becomes a system line');
  await until(async () => (await second.locator('.chat-silenced').count()) > 0, 'silence badge appears', 8000);
  assert.match((await second.locator('.chat-silenced').textContent()) ?? '', /Silenced · \d+s/);
  assert.equal(await secondInput.isDisabled(), true, 'input disabled while silenced');
  assert.ok((await secondHistory('Chat is disabled for you for').count()) > 0, 'silence announced as a system line');
  await second.screenshot({ path: `${output}/12-chat-silenced.png` });
  await second.setViewportSize({ width: 390, height: 844 });
  await second.waitForTimeout(600);
  assert.equal(await second.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no mobile horizontal overflow');
  await second.screenshot({ path: `${output}/13-chat-mobile-silenced.png` });
  await stubbed.close();
  console.log('PASS: a modified client flooding link messages gets silenced with a visible badge and disabled input on desktop and mobile.');
  assert.deepEqual(errors, [], 'no page errors');
} finally {
  await browser.close();
  await vite.close();
  server.kill('SIGTERM');
  await until(() => server.exitCode !== null || server.signalCode !== null, 'isolated server exit');
  await database.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
}
