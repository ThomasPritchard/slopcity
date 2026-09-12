import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit, type Locator } from 'playwright';

const endpoint = 'http://localhost:5173';
const output = 'output/playwright/soft-corner-menu';
await mkdir(output, { recursive: true });
const checks: string[] = [];
const errors: string[] = [];
const failures: string[] = [];

async function visibleTarget(target: Locator, width: number, height: number) {
  const box = await target.boundingBox();
  assert.ok(box && box.height >= 44 && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, 'Control is in the viewport and at least 44px tall');
}

for (const type of [chromium, webkit]) {
  const browser = await type.launch({ headless: true, ...(type === chromium && process.platform === 'darwin' ? { args: ['--use-angle=metal'] } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1656, height: 950 }, hasTouch: type === webkit });
    await context.addInitScript(() => {
      localStorage.setItem('slop-city-comfort', JSON.stringify({ graphics: 'medium', motion: 'reduced', effects: 0, ambience: 0 }));
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw Error('No real microphone in menu acceptance'); };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    page.on('pageerror', error => errors.push(`${type.name()}: ${error.message}`));
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin === endpoint && response.status() >= 400 && !(url.pathname === '/game/api/profile' && response.status() === 401)) failures.push(`${response.status()} ${url.pathname}`);
    });
    await page.goto(endpoint);
    const name = page.getByRole('textbox', { name: 'What should we call you?', exact: true });
    const choose = page.getByRole('button', { name: 'Choose your look', exact: true });
    await choose.waitFor();
    console.log(`${type.name()}: menu ready`);
    await page.getByRole('heading', { name: 'Slop City', exact: true }).waitFor();
    assert.equal(await page.locator('.welcome-logo img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), true, 'The actual vector logo loaded');
    await page.evaluate(() => document.fonts.ready);
    await name.fill('DevToast');
    await name.blur();
    for (const [label, width, height] of [['desktop', 1656, 950], ['portrait', 390, 844], ['landscape', 844, 390], ['small-phone', 320, 568]] as const) {
      await page.setViewportSize({ width, height });
      await page.locator('.welcome-layout').evaluate(node => node.scrollTop = 0);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No page overflow');
      assert.equal(await page.locator('.welcome-layout').evaluate(node => node.scrollWidth > node.clientWidth + 1), false, 'No horizontal scroll inside the menu');
      await page.screenshot({ path: `${output}/${type.name()}-${label}.png` });
      console.log(`${type.name()}: ${label} captured`);
      if (label === 'small-phone') await choose.scrollIntoViewIfNeeded();
      await visibleTarget(choose, width, height);
      await name.scrollIntoViewIfNeeded();
      await visibleTarget(name, width, height);
      const memory = page.getByRole('button', { name: 'Open our first community memory', exact: true });
      await memory.click();
      const dialog = page.getByRole('dialog', { name: 'Slop City memories', exact: true });
      await dialog.waitFor();
      console.log(`${type.name()}: ${label} notice board opened`);
      await visibleTarget(dialog.getByRole('button', { name: 'Close community', exact: true }), width, height);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await memory.evaluate(node => document.activeElement === node), true, 'Closing the notice board returns focus to its opener');
      checks.push(`${type.name()}: ${label} layout, entry controls, notice board and restored focus`);
    }
    await page.setViewportSize({ width: 1656, height: 950 });
    await name.fill('');
    await choose.click();
    await page.getByRole('alert').filter({ hasText: 'Please enter your name.' }).waitFor();
    await name.fill('Menu check');
    await name.press('Enter');
    await page.getByRole('button', { name: 'Join the square', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Skin tone 1', exact: true }).isVisible(), true);
    await page.screenshot({ path: `${output}/${type.name()}-changing-room.png` });
    await page.getByRole('button', { name: 'Join the square', exact: true }).click();
    await page.getByRole('button', { name: 'Open town map', exact: true }).waitFor();
    await page.reload();
    await choose.waitFor();
    assert.equal(await name.inputValue(), 'Menu check', 'A saved guest name survives a reload');
    await page.getByText('Your guest is saved in this browser.', { exact: true }).waitFor();
    checks.push(`${type.name()}: empty-name validation, keyboard submit, changing room, town join and returning guest`);
  } finally { await browser.close(); }
}
assert.deepEqual(errors, [], 'No browser runtime errors');
assert.deepEqual(failures, [], 'No unexpected local request failures');
await writeFile(`${output}/results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), graphics: 'medium', checks, errors, failures, limits: 'Headless Chromium and WebKit with emulated viewport/touch sizes. This does not establish physical phone performance.' }, null, 2));
checks.forEach(check => console.log(`PASS: ${check}`));
