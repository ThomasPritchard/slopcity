import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Only the disposable loopback deployment uses this local CA exception.
const origin = 'https://game.localhost:8443';
await mkdir('output/playwright/deployment', { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'] });
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 720 } });
  await context.addInitScript(() => localStorage.setItem('slop-city-comfort', JSON.stringify({ low: true, motion: 'reduced', effects: 0, ambience: 0 })));
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('textbox', { name: 'WHAT SHOULD WE CALL YOU?' }).fill('Docker visitor');
  await page.getByRole('button', { name: 'Enter', exact: true }).click();
  await page.getByRole('button', { name: 'Join the square', exact: true }).waitFor();
  await page.screenshot({ path: 'output/playwright/deployment/changing-room.png' });
  await page.getByRole('button', { name: 'Join the square', exact: true }).click();
  await page.getByRole('button', { name: 'Open town map' }).waitFor();
  const cookie = (await context.cookies()).find(item => item.name === 'slop_guest');
  assert.ok(cookie?.secure && cookie.httpOnly && cookie.path === '/game');
  await page.getByRole('textbox', { name: 'Message to town' }).fill('Hello from Docker');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByRole('log').getByText('Hello from Docker', { exact: false }).waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'output/playwright/deployment/town.png' });
  await page.reload();
  await page.getByRole('textbox', { name: 'WHAT SHOULD WE CALL YOU?' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'WHAT SHOULD WE CALL YOU?' }).inputValue(), 'Docker visitor');
  assert.deepEqual(errors, []);
  console.log('PASS: headless Chromium production assets, 3D changing room, town join/chat through HTTPS/WSS, secure cookie and profile reload.');
} finally {
  await browser.close();
}
