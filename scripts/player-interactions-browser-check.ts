import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { mkdir, writeFile, cp, mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as pathJoin, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { createServer, type ViteDevServer } from 'vite';
import { chromium, webkit, type Browser, type Page } from 'playwright';
import { EMOTE_POSES } from '../shared/emotePoses.ts';

// Real browser + server behavior in a disposable database. Only the salary payment
// is a fixture; it exercises the actual allowance trigger and gift transaction.
loadEnvFile('.env');
const source = new URL(process.env.DATABASE_URL!);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Use the local development database only');
// Snapshot the working source so concurrent world/asset edits cannot hot-reload a
// browser halfway through a journey. The test never writes into the source tree.
const sourceRoot = process.cwd(), snapshotRoot = await mkdtemp(pathJoin(tmpdir(), 'slop-interactions-browser-'));
for (const entry of ['src', 'shared', 'server', 'public', 'index.html', 'package.json']) await cp(pathJoin(sourceRoot, entry), pathJoin(snapshotRoot, entry), { recursive: true });
await symlink(pathJoin(sourceRoot, 'node_modules'), pathJoin(snapshotRoot, 'node_modules'), 'dir');
const schema = `interactions_browser_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: source.toString() });
source.searchParams.set('options', `-c search_path=${schema}`);
const isolated = new Pool({ connectionString: source.toString() });
const port = Number(process.env.INTERACTION_BROWSER_PORT || 5184), serverPort = Number(process.env.INTERACTION_SERVER_PORT || 2576);
const endpoint = `http://localhost:${port}`, output = 'output/playwright/player-interactions';
await mkdir(output, { recursive: true });
await admin.query(`CREATE SCHEMA ${schema}`);
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(serverPort), DATABASE_URL: source.toString(), APP_ORIGIN: endpoint }, cwd: snapshotRoot, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.resume(); server.stderr.resume();
let vite: ViteDevServer | undefined, browser: Browser | undefined, page: Page | undefined;
const errors: string[] = [], failedRequests: string[] = [], checks: string[] = [];
let droppedGiftResponses = 0;
async function until(check: () => Promise<boolean>, label: string, timeout = 15000) {
  const start = Date.now(); while (!await check()) { if (Date.now() - start > timeout) throw new Error(`Timed out: ${label}`); await delay(40); }
}
async function attachScene(p: Page) {
  await p.evaluate(async () => {
    const source = await (await fetch('/src/world/scene.ts')).text();
    const path = source.match(/import\s*\{\s*Engine\s*\}\s*from\s*["']([^"']+)/)?.[1];
    if (!path) throw new Error('Could not resolve the actual renderer Engine');
    const { Engine } = await import(path); (window as any).interactionScene = Engine.Instances[0].scenes[0];
  });
}
async function join(p: Page, name: string, reload = false) {
  page = p;
  console.log(`Joining ${name}${reload ? ' after reload' : ''}…`);
  if (!reload) {
    p.on('pageerror', error => errors.push(error.message));
    p.on('console', message => { if (message.type() === 'error' && /Maximum update depth|React update trace/.test(message.text())) errors.push(message.text()); });
    await p.addInitScript(({ low }) => {
      if (low) localStorage.setItem('slop-city-comfort', JSON.stringify({ low: true, motion: 'system', effects: .45, ambience: .35 }));
      const original = console.error;
      console.error = (...args) => { original(...args); if (args.some(value => typeof value === 'string' && value.includes('Maximum update depth'))) original(new Error('React update trace').stack); };
    }, { low: process.env.INTERACTION_PERFORMANCE === '1' });
    p.on('requestfailed', request => {
      if (request.url().includes('/api/social/gifts') && droppedGiftResponses > 0) return;
      if (request.failure()?.errorText.includes('cancelled') || request.failure()?.errorText.includes('ERR_ABORTED')) return;
      failedRequests.push(new URL(request.url()).pathname);
    });
    await p.goto(endpoint);
  }
  await p.getByRole('textbox', { name: 'WHAT SHOULD WE CALL YOU?' }).waitFor();
  await p.waitForFunction(() => !(document.querySelector('#display-name') as HTMLInputElement)?.disabled);
  if (!reload) await p.getByRole('textbox', { name: 'WHAT SHOULD WE CALL YOU?' }).fill(name);
  await p.getByRole('button', { name: 'Enter', exact: true }).click({ timeout: 90000 });
  await p.getByRole('button', { name: 'Join the square', exact: true }).click();
  await p.getByRole('button', { name: 'Open town map', exact: true }).waitFor();
  const dismiss = p.getByRole('button', { name: 'Dismiss welcome' }); if (await dismiss.isVisible()) await dismiss.click();
  await attachScene(p);
  console.log(`${name} joined.`);
}
async function pose(p: Page, name: string) {
  return p.evaluate(name => {
    const scene = (window as any).interactionScene, root = scene.meshes.find((m: any) => m.name === `sign-${name}`)?.parent;
    if (!root) return null;
    return { x: root.position.x, y: root.position.y, z: root.position.z, heading: root.rotation.y, clips: scene.animationGroups.filter((g: any) => g.name.startsWith(root.name + '/') && g.isStarted).map((g: any) => ({ name: g.name.split('/').at(-1), frame: g.animatables[0]?.masterFrame, weight: g.animatables[0]?.weight })) };
  }, name);
}
async function frame(p: Page) {
  await p.evaluate(() => { const camera = (window as any).interactionScene.activeCamera; camera.alpha = -Math.PI / 2; camera.beta = 1.2; camera.radius = 5.2; });
  await p.waitForTimeout(350);
}
async function screenPoint(p: Page, name: string) {
  return p.evaluate(name => {
    const scene = (window as any).interactionScene, root = scene.meshes.find((m: any) => m.name === `sign-${name}`).parent;
    const point = root.position.clone(); point.y += 1.15;
    const engine = scene.getEngine(), width = engine.getRenderWidth(), height = engine.getRenderHeight();
    const screen = point.constructor.Project(point, scene.getViewMatrix().constructor.Identity(), scene.getTransformMatrix(), scene.activeCamera.viewport.toGlobal(width, height));
    const rect = engine.getRenderingCanvas().getBoundingClientRect(); return { x: rect.left + screen.x * rect.width / width, y: rect.top + screen.y * rect.height / height };
  }, name);
}
async function openCard(p: Page, name: string) {
  await p.getByRole('button', { name: 'Open neighbours', exact: true }).click();
  await p.mouse.click(8, 8); await p.waitForTimeout(300);
  assert.equal(await p.getByRole('dialog', { name: 'Your neighbours.' }).count(), 1, 'Social persists after a background click');
  await p.keyboard.press('Escape');
  await p.getByRole('dialog').waitFor({ state: 'detached' });
  await p.getByRole('button', { name: 'Open neighbours', exact: true }).click();
  await p.locator('.social-person-name').getByRole('button', { name: `View ${name}`, exact: true }).click();
  await p.getByRole('dialog', { name }).waitFor();
}
async function layouts(p: Page, prefix: string) {
  for (const [label, width, height] of [['portrait', 390, 844], ['landscape', 844, 390]] as const) {
    await p.setViewportSize({ width, height }); await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label} overflow`);
    const dialog = await p.getByRole('dialog').boundingBox(); assert.ok(dialog && dialog.x >= 0 && dialog.y >= 0 && dialog.x + dialog.width <= width + 1 && dialog.y + dialog.height <= height + 1, `${label} dialog fits`);
    await p.screenshot({ path: `${output}/${prefix}-${label}.png` });
    for (const button of await p.getByRole('dialog').locator('button:visible').all()) { const box = await button.boundingBox(); assert.ok(box && box.height >= 43, 'touch target height'); }
  }
}
try {
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${serverPort}/health`)).ok; } catch { return false; } }, 'isolated server');
  vite = await createServer({ configFile: false, root: snapshotRoot, cacheDir: resolve(output, 'vite-cache'), server: { host: '127.0.0.1', port, strictPort: true, hmr: false, proxy: { '/game': { target: `http://127.0.0.1:${serverPort}`, ws: true, rewrite: path => path.replace(/^\/game/, '') } } } });
  await vite.listen();
  browser = await (process.env.BROWSER === 'chromium' ? chromium : webkit).launch({ headless: true, ...(process.env.BROWSER === 'chromium' && process.platform === 'darwin' ? { args: ['--use-angle=metal'] } : {}) });
  if (process.env.INTERACTION_LEGACY_ONLY !== '1') {
  const aContext = await browser.newContext({ viewport: { width: 1280, height: 900 } }), bContext = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const a = page = await aContext.newPage(), b = await bContext.newPage();
  await join(a, 'River'); await join(b, 'Bea'); await until(async () => !!await pose(a, 'Bea'), 'second rendered character');
  const aProfile = await a.evaluate(async () => await (await fetch('/game/api/profile')).json()), bProfile = await b.evaluate(async () => await (await fetch('/game/api/profile')).json());
  await frame(a); const point = await screenPoint(a, 'Bea');
  await a.mouse.move(point.x, point.y); await a.mouse.down(); await a.mouse.move(point.x + 100, point.y + 15, { steps: 8 }); await a.mouse.up();
  assert.equal(await a.getByRole('dialog').count(), 0, 'camera drag must not select a player');
  await frame(a); const target = await screenPoint(a, 'Bea'); await a.mouse.click(target.x, target.y);
  await a.getByRole('dialog', { name: 'Bea' }).waitFor();
  await a.mouse.click(8, 8); await a.waitForTimeout(300);
  assert.equal(await a.getByRole('dialog', { name: 'Bea' }).count(), 1, 'Player card persists after a background click');
  await a.keyboard.press('Escape');
  await a.getByRole('dialog').waitFor({ state: 'detached' });
  await openCard(a, 'Bea');
  assert.equal(await a.getByRole('button', { name: /Give credits/ }).isDisabled(), true, 'fresh grant cannot be gifted');
  await a.screenshot({ path: `${output}/player-card-desktop.png` });
  await a.keyboard.press('Tab'); assert.equal(await a.getByRole('dialog').evaluate(dialog => dialog.contains(document.activeElement)), true);
  await a.getByRole('button', { name: 'Add friend', exact: true }).click(); await a.getByRole('button', { name: 'Cancel friend request', exact: true }).waitFor();
  await b.getByRole('button', { name: 'Open neighbours', exact: true }).click();
  await b.getByRole('button', { name: 'Accept friend request from River', exact: true }).click();
  await a.getByRole('button', { name: 'Remove friend', exact: true }).waitFor();
  await b.getByRole('button', { name: 'Close neighbours panel', exact: true }).click();
  checks.push('actual avatar picking; camera drag separation; keyboard focus; starter-gift denial; mutual friendship');
  for (const kind of ['handshake', 'hug'] as const) {
    if (kind === 'hug') await openCard(a, 'Bea');
    await a.getByRole('button', { name: EMOTE_POSES[kind].label, exact: true }).click();
    await b.getByRole('button', { name: `Accept ${kind}`, exact: true }).click();
    await a.getByRole('button', { name: 'Stop emote', exact: true }).waitFor();
    await a.waitForTimeout(kind === 'hug' ? 1350 : 1100);
    const pa = (await pose(a, 'River'))!, pb = (await pose(a, 'Bea'))!, peer = (await pose(b, 'River'))!;
    assert.ok(Math.abs(Math.hypot(pa.x - pb.x, pa.z - pb.z) - EMOTE_POSES[kind].distance) < .02, 'rendered matched spacing');
    const clip = pa.clips.find((c: any) => c.name === EMOTE_POSES[kind].clipA), remoteClip = peer.clips.find((c: any) => c.name === EMOTE_POSES[kind].clipA);
    assert.ok(clip && clip.weight > .95 && clip.frame > 5, 'authored shared clip actually running');
    assert.ok(remoteClip && Math.abs(remoteClip.frame - clip.frame) < 8, 'two renderer timelines align');
    await a.screenshot({ path: `${output}/${kind}-browser.png` });
    await a.getByRole('button', { name: 'Stop emote', exact: true }).waitFor({ state: 'detached', timeout: 6000 });
    const finished = (await pose(a, 'River'))!; await a.waitForTimeout(200); const settled = (await pose(a, 'River'))!;
    assert.ok(Math.hypot(finished.x - settled.x, finished.z - settled.z) < .02, 'no stale movement after emote');
  }
  checks.push('consent in two browsers; handshake and hug rendered with shared timing and spacing; clean completion');
  await a.locator('#world').focus(); await a.keyboard.down('Shift'); await a.keyboard.down('w'); await a.waitForTimeout(300);
  assert.ok((await pose(a, 'River'))!.clips.some((c: any) => c.name === 'Run' && c.weight > .6), 'run animation');
  await a.keyboard.up('w'); await a.keyboard.up('Shift'); await a.waitForTimeout(250);
  await a.keyboard.press('Space'); await until(async () => ((await pose(a, 'River'))?.y ?? 0) > .22, 'visible hop');
  assert.ok((await pose(a, 'River'))!.clips.some((c: any) => c.name === 'Jump'), 'jump clip');
  await a.screenshot({ path: `${output}/jump-browser.png` }); await a.waitForTimeout(800); assert.equal((await pose(a, 'River'))!.y, 0, 'lands on ground');
  await a.getByRole('button', { name: 'Toggle sprint', exact: true }).click();
  await openCard(a, 'Bea'); await a.keyboard.press('Escape');
  assert.equal(await a.getByRole('button', { name: 'Toggle sprint', exact: true }).getAttribute('aria-pressed'), 'false', 'menu clears sprint toggle');
  checks.push('keyboard sprint/run; visible replicated hop and landing; menu releases held sprint');
  // Simulate one salary payment solely in the disposable schema, via the same trigger.
  const fixture = await isolated.connect();
  try { await fixture.query('BEGIN'); await fixture.query('SELECT profile_id FROM economy_wallets WHERE profile_id=$1 FOR UPDATE', [aProfile.id]); await fixture.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,'browser-salary-fixture','salary',100)", [aProfile.id]); await fixture.query('UPDATE economy_wallets SET balance=balance+100,revision=revision+1 WHERE profile_id=$1', [aProfile.id]); await fixture.query('COMMIT'); } finally { fixture.release(); }
  await openCard(a, 'Bea'); await until(async () => await a.getByRole('button', { name: /Give credits/ }).isEnabled(), 'salary enables gifting');
  await layouts(a, 'player-card'); await a.setViewportSize({ width: 1280, height: 900 });
  await a.getByRole('button', { name: /Give credits/ }).click(); await a.getByLabel('Credits for Bea', { exact: true }).fill('40');
  await a.getByRole('button', { name: 'Review gift', exact: true }).click();
  await layouts(a, 'gift-confirmation'); await a.setViewportSize({ width: 1280, height: 900 });
  await a.route('**/game/api/social/gifts', async route => { droppedGiftResponses++; await route.fetch(); await route.abort('failed'); }, { times: 1 });
  await a.getByRole('button', { name: 'Send 40 credits', exact: true }).click();
  await a.getByRole('button', { name: 'Check gift result', exact: true }).waitFor();
  await until(async () => (await isolated.query('SELECT balance FROM economy_wallets WHERE profile_id=$1', [bProfile.id])).rows[0].balance === 1040, 'gift committed once');
  await a.reload(); await until(async () => !await pose(b, 'River'), 'reload departs old session'); await join(a, 'River', true);
  await b.getByRole('button', { name: 'Open settings', exact: true }).click(); await b.getByRole('button', { name: 'Leave the square', exact: true }).click();
  await a.getByRole('button', { name: 'Open neighbours', exact: true }).click();
  await a.getByRole('button', { name: 'Check pending gift to Bea', exact: true }).click();
  await a.getByRole('button', { name: 'Check gift result', exact: true }).click();
  await a.getByText('40 credits sent to Bea.', { exact: true }).waitFor();
  assert.equal((await isolated.query('SELECT balance FROM economy_wallets WHERE profile_id=$1', [bProfile.id])).rows[0].balance, 1040);
  assert.equal((await isolated.query('SELECT gifting_allowance FROM economy_wallets WHERE profile_id=$1', [aProfile.id])).rows[0].gifting_allowance, 60);
  await a.getByRole('button', { name: 'Remove friend', exact: true }).waitFor();
  await a.screenshot({ path: `${output}/gift-receipt-browser.png` });
  checks.push('portrait and short landscape player cards and gift confirmation; real gift with lost response; saved retry after reload and recipient departure; conserved balances and allowance');
  await a.getByRole('button', { name: 'Close player card', exact: true }).click();
  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const touch = page = await touchContext.newPage(); await join(touch, 'Cedar');
  await until(async () => !!await pose(touch, 'River'), 'neighbour on touch device');
  await frame(touch); const touchTarget = await screenPoint(touch, 'River'); await touch.touchscreen.tap(touchTarget.x, touchTarget.y);
  await touch.getByRole('dialog', { name: 'River', exact: true }).waitFor();
  await touch.getByRole('button', { name: 'Close player card', exact: true }).tap();
  await touch.getByRole('button', { name: 'Toggle sprint', exact: true }).tap();
  await until(async () => await touch.getByRole('button', { name: 'Toggle sprint', exact: true }).getAttribute('aria-pressed') === 'true', 'touch sprint toggled', 3000);
  await touch.getByRole('button', { name: 'Jump', exact: true }).tap();
  await until(async () => ((await pose(touch, 'Cedar'))?.y ?? 0) > .18, 'touch jump rises');
  await touch.waitForTimeout(800); assert.equal((await pose(touch, 'Cedar'))!.y, 0);
  if (process.env.BROWSER === 'chromium') {
    // Chromium exposes real screen touch gestures, including a held joystick.
    const cdp = await touchContext.newCDPSession(touch), stick = (await touch.getByRole('group', { name: 'Touch movement control' }).boundingBox())!;
    const x = stick.x + stick.width / 2, y = stick.y + stick.height / 2, before = (await pose(touch, 'Cedar'))!;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 32, id: 1 }] });
    await touch.waitForTimeout(300);
    assert.ok((await pose(touch, 'Cedar'))!.clips.some((c: any) => c.name === 'Run' && c.weight > .6), 'touch joystick uses sprint');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touch.waitForTimeout(200);
    const after = (await pose(touch, 'Cedar'))!; assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > .8, 'held touch moves player');
    await cdp.detach();
    checks.push('real emulated-screen joystick drag and release with sprint');
  }
  for (const [label, width, height] of [['portrait', 390, 844], ['landscape', 844, 390]] as const) {
    await touch.setViewportSize({ width, height }); await touch.waitForTimeout(200);
    for (const name of ['Toggle sprint', 'Jump']) {
      const box = (await touch.getByRole('button', { name, exact: true }).boundingBox())!;
      assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, `${label} movement touch targets`);
    }
    await touch.screenshot({ path: `${output}/touch-controls-${label}.png` });
    await touch.getByRole('button', { name: 'Open neighbours', exact: true }).tap();
    await touch.locator('.social-person-name').getByRole('button', { name: 'View River', exact: true }).tap();
    await touch.getByRole('dialog', { name: 'River', exact: true }).waitFor();
    await touch.getByRole('button', { name: 'Close player card', exact: true }).tap();
    assert.equal(await touch.getByRole('button', { name: 'Toggle sprint', exact: true }).getAttribute('aria-pressed'), 'false');
  }
  await touchContext.close(); page = a;
  checks.push('touch avatar selection, sprint toggle and jump; portrait/landscape controls and Social navigation');
  assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
  await aContext.close(); await bContext.close(); page = undefined;
  }
  if (process.env.INTERACTION_LEGACY_CHECKS === '1' || process.env.INTERACTION_LEGACY_ONLY === '1') {
    const scripts = process.env.INTERACTION_LEGACY_ONLY === '1' ? ['wave-check.ts', 'character-check.ts'] : ['social-check.ts', 'wave-check.ts', 'character-check.ts'];
    for (const script of scripts) {
      const child = spawn(process.execPath, ['--import', 'tsx', `scripts/${script}`], { env: { ...process.env, GAME_URL: endpoint }, cwd: sourceRoot, stdio: 'inherit' });
      const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
      assert.equal(code, 0, `existing ${script}`);
    }
    checks.push(`existing ${scripts.join(', ')} browser regressions against the same source snapshot`);
  }
  await writeFile(`${output}/${process.env.INTERACTION_LEGACY_ONLY === '1' ? 'legacy' : 'browser'}-results-${process.env.BROWSER || 'webkit'}.json`, JSON.stringify({ checkedAt: new Date().toISOString(), node: process.version, browser: process.env.INTERACTION_LEGACY_ONLY === '1' ? 'WebKit (wave) and Chromium (character)' : process.env.BROWSER || 'webkit', chromiumBackend: process.env.BROWSER === 'chromium' ? process.platform === 'darwin' ? 'Metal' : 'default' : undefined, performanceMode: process.env.INTERACTION_PERFORMANCE === '1', checks, errors, failedRequests, salaryEvidence: process.env.INTERACTION_LEGACY_ONLY === '1' ? 'not used in legacy checks' : 'one isolated ledger fixture, not elapsed real salary time' }, null, 2));
  console.log(`PASS: ${checks.join('; ')}.`);
} catch (error) {
  await page?.screenshot({ path: `${output}/browser-failure.png` }).catch(() => {});
  console.error('Browser check context:', JSON.stringify({ checks, errors, failedRequests }));
  throw error;
} finally {
  await browser?.close(); await vite?.close();
  server.kill('SIGTERM');
  await until(async () => server.exitCode !== null || server.signalCode !== null, 'isolated server shutdown').catch(() => { server.kill('SIGKILL'); });
  await isolated.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); await rm(snapshotRoot, { recursive: true, force: true });
}
