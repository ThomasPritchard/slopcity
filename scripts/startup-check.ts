import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('output/playwright', { recursive: true });
// Vite appends a cache timestamp after an edit; intercept both URL forms.
const mainModule = /\/src\/main\.tsx(?:\?|$)/;
for (const [name, type] of [['Chromium', chromium], ['WebKit', webkit]] as const) {
  const browser = await type.launch({ headless: true, ...(type === chromium && process.platform === 'darwin' ? { args: ['--use-angle=metal'] } : {}) });
  try {
    const page = await browser.newPage();
    await page.route(mainModule, route => route.abort());
    await page.goto('http://localhost:5173');
    await page.getByRole('heading', { name: 'The game could not start.' }).waitFor();
    assert.notEqual(await page.locator('#startup').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
    if (name === 'Chromium') await page.screenshot({ path: 'output/playwright/19-startup-recovery.png' });
    await page.unroute(mainModule);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByRole('textbox', { name: 'What should we call you?' }).waitFor();
    assert.equal(await page.locator('#startup').count(), 0);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('textbox', { name: 'What should we call you?' }).fill('Startup check');
    await page.getByRole('button', { name: 'Choose your look', exact: true }).click();
    await page.getByRole('button', { name: 'Join the square', exact: true }).click();
    await page.getByRole('button', { name: 'Open town map' }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS: ${name} failed module shows recovery; retry loads and joins without errors.`);
  } finally { await browser.close(); }
}
