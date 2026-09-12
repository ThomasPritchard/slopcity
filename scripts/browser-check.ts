import { chromium, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'output/playwright';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
const endpoint = process.env.GAME_URL || 'http://localhost:5173';
function observe(page: Page) { page.on('pageerror', error => errors.push(error.message)); }
async function join(page: Page, name: string, mobilePreview = false) {
  observe(page); await page.goto(endpoint);
  await page.getByRole('textbox', { name: 'What should we call you?' }).fill(name);
  await page.getByRole('button', { name: 'Choose your look', exact: true }).click();
  await page.getByRole('button', { name: 'Join the square', exact: true }).waitFor();
  if (mobilePreview) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${output}/09-mobile-changing-room.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 844, height: 390 });
  }
  await page.getByRole('button', { name: 'Join the square', exact: true }).click();
  await page.getByRole('button', { name: 'Open town map' }).waitFor();
  await page.waitForTimeout(700);
}
async function walk(page: Page, key: string, milliseconds: number) {
  await page.locator('#world').focus(); await page.keyboard.down(key); await page.waitForTimeout(milliseconds); await page.keyboard.up(key); await page.waitForTimeout(350);
}
async function mapPosition(page: Page) {
  await page.getByRole('button', { name: 'Open town map' }).click();
  const marker = page.locator('.town-map circle[fill="#253d33"]');
  const position = { x: Number(await marker.getAttribute('cx')), z: -Number(await marker.getAttribute('cy')) };
  await page.getByRole('button', { name: 'Close panel' }).click();
  return position;
}
async function walkToAxis(page: Page, axis: 'x' | 'z', target: number) {
  // Follow the server-backed map instead of assuming a fixed renderer speed.
  for (let attempt = 0; attempt < 10; attempt++) {
    const position = await mapPosition(page), delta = target - position[axis];
    if (Math.abs(delta) < .65) return;
    const key = axis === 'x' ? (delta > 0 ? 'd' : 'a') : (delta > 0 ? 'w' : 's');
    await walk(page, key, Math.min(2200, Math.max(100, Math.abs(delta) / 4.2 * 1000)));
  }
  assert.fail(`Could not reach ${axis}=${target}; last position ${JSON.stringify(await mapPosition(page))}`);
}
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const page = await desktop.newPage(); observe(page);
  await page.goto(endpoint);
  await page.getByRole('button', { name: 'Choose your look', exact: true }).waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${output}/01-welcome.png` });
  await page.getByRole('textbox', { name: 'What should we call you?' }).fill('Tom');
  assert.equal(await page.getByRole('button', { name: 'Skin tone 1' }).count(), 0, 'appearance controls are absent from entry menu');
  await page.getByRole('button', { name: 'Choose your look', exact: true }).click();
  await page.getByRole('button', { name: 'Join the square', exact: true }).waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${output}/07-changing-room.png` });
  await page.getByRole('button', { name: 'Outfit colour 4' }).click();
  await page.getByRole('button', { name: 'Rotate character left' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${output}/08-changing-room-outfit.png` });
  await page.getByRole('button', { name: 'Join the square', exact: true }).click();
  await page.getByRole('button', { name: 'Open town map' }).waitFor();
  const otherContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const other = await otherContext.newPage(); await join(other, 'Alex');
  await page.waitForFunction(() => document.querySelector('.population')?.textContent?.includes('2'));
  await other.getByRole('textbox', { name: 'Message to town' }).fill('Hello Tom — see you by the fountain.');
  await other.getByRole('button', { name: 'Send message' }).click();
  await page.getByText('Hello Tom — see you by the fountain.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Wave to neighbours' }).click();
  await page.screenshot({ path: `${output}/02-town-square.png` });
  console.log('PASS: two independent browser contexts join, show two players and exchange chat.');
  await otherContext.close();
  await page.waitForFunction(() => document.querySelector('.population')?.textContent?.includes('1'));
  console.log('PASS: closing the second browser removes its player.');

  await page.getByRole('button', { name: 'Open town map' }).click();
  const before = await page.locator('.town-map circle[fill="#253d33"]').getAttribute('cy');
  await page.getByRole('button', { name: 'Close panel' }).click();
  await walk(page, 'w', 1500);
  await page.getByRole('button', { name: 'Open town map' }).click();
  const after = await page.locator('.town-map circle[fill="#253d33"]').getAttribute('cy');
  assert.ok(Number(after) < Number(before) - 3, 'keyboard movement advances the avatar');
  await page.screenshot({ path: `${output}/03-town-map.png` });
  await page.getByRole('button', { name: 'Close panel' }).click();
  console.log('PASS: keyboard movement changes the server-backed map position.');
  // Walk around the fountain, then through the casino doorway using real input.
  await walkToAxis(page, 'x', -5);
  await walkToAxis(page, 'z', 9);
  await walkToAxis(page, 'x', 0);
  await walkToAxis(page, 'z', 18);
  await page.getByRole('heading', { name: 'The Meridian Casino', exact: true }).waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${output}/06-casino-interior.png` });
  console.log('PASS: the casino can be entered through its doorway.');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('combobox', { name: 'Graphics quality' }).selectOption('medium');
  const metrics = await page.locator('.diagnostics').innerText();
  const renderer = await page.evaluate(() => {
    const gl = (document.querySelector('#world') as HTMLCanvasElement).getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return extension ? gl?.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable';
  });
  await page.getByRole('button', { name: 'Close panel' }).click();
  await desktop.close();

  const phone = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const mobile = await phone.newPage(); await join(mobile, 'Jordan', true);
  assert.equal(await mobile.locator('.joystick').isVisible(), true);
  await mobile.getByRole('button', { name: 'Open town map' }).click();
  const mobileBefore = Number(await mobile.locator('.town-map circle[fill="#253d33"]').getAttribute('cy'));
  await mobile.getByRole('button', { name: 'Close panel' }).click();
  const stick = await mobile.locator('.joystick').boundingBox();
  assert.ok(stick);
  const cdp = await phone.newCDPSession(mobile);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: stick.x + stick.width / 2, y: stick.y + 8 }] });
  await mobile.waitForTimeout(1300);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForTimeout(400);
  await mobile.getByRole('button', { name: 'Open town map' }).click();
  const mobileAfter = Number(await mobile.locator('.town-map circle[fill="#253d33"]').getAttribute('cy'));
  assert.ok(mobileAfter < mobileBefore - 2, 'emulated touch joystick moves the citizen');
  await mobile.getByRole('button', { name: 'Close panel' }).click();
  await mobile.screenshot({ path: `${output}/04-mobile-landscape.png` });
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.screenshot({ path: `${output}/05-mobile-portrait.png` });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await phone.close();
  assert.deepEqual(errors, [], 'no browser runtime errors');
  await writeFile(`${output}/browser-results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'headless', browser: browser.version(), checks: ['name-only entry', '3D changing room and live outfit controls', 'two independent contexts', 'cross-client chat', 'keyboard movement', 'casino entry', 'departure', 'performance toggle', 'mobile layouts and emulated touch movement'], desktopMetrics: metrics, renderer, errors, limits: 'Mobile emulation only. Blender assets loaded; not native phone performance or 64-avatar rendering evidence.' }, null, 2));
  console.log('PASS: headless desktop and mobile layout checks; no page errors. Screenshots saved.');
} finally { await browser.close(); }
