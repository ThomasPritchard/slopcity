import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('output/playwright', { recursive: true });
for (const [name, type] of [['Chromium', chromium], ['WebKit', webkit]] as const) {
  const browser = await type.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/src/main.tsx', route => route.abort());
    await page.goto('http://localhost:5173');
    await page.getByRole('heading', { name: 'The game could not start.' }).waitFor();
    assert.notEqual(await page.locator('#startup').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
    if (name === 'Chromium') await page.screenshot({ path: 'output/playwright/19-startup-recovery.png' });
    await page.unroute('**/src/main.tsx');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByRole('textbox', { name: 'WHAT SHOULD WE CALL YOU?' }).waitFor();
    assert.equal(await page.locator('#startup').count(), 0);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('textbox', { name: 'WHAT SHOULD WE CALL YOU?' }).fill('Startup check');
    await page.getByRole('button', { name: 'Enter', exact: true }).click();
    await page.getByRole('button', { name: 'Join the square', exact: true }).click();
    await page.getByRole('button', { name: 'Open town map' }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS: ${name} failed module shows recovery; retry loads and joins without errors.`);
  } finally { await browser.close(); }
}
