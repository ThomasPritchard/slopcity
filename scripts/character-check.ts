import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit, type Locator } from 'playwright';

const output = 'output/playwright/soft-corner-changing-room';
await mkdir(output, { recursive: true });
const checks: string[] = [];
const errors: string[] = [];

async function visibleTarget(target: Locator, width: number, height: number) {
  const box = await target.boundingBox();
  const visible = box && box.width >= 44 && box.height >= 44 && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1;
  if (!visible) await target.page().screenshot({ path: `${output}/failed-target.png` });
  assert.ok(visible, `Control is in the viewport with a 44px touch target: ${await target.getAttribute('aria-label') || await target.getAttribute('id') || await target.textContent()}; bounds=${JSON.stringify(box)}`);
}

for (const type of [chromium, webkit]) {
  const browser = await type.launch({ headless: true, ...(type === chromium && process.platform === 'darwin' ? { args: ['--use-angle=metal'] } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1656, height: 950 }, hasTouch: type === webkit });
    await context.addInitScript(() => {
      localStorage.setItem('slop-city-comfort', JSON.stringify({ graphics: 'medium', motion: 'reduced', effects: 0, ambience: 0 }));
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw Error('No real microphone in character acceptance'); };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    page.on('pageerror', error => errors.push(`${type.name()}: ${error.message}`));
    await page.goto(process.env.GAME_URL || 'http://localhost:5173');
    await page.getByRole('textbox', { name: 'What should we call you?', exact: true }).fill('DevToast');
    const choose = page.getByRole('button', { name: 'Choose your look', exact: true });
    await choose.click({ timeout: 90_000 });
    const join = page.getByRole('button', { name: 'Join the square', exact: true });
    await join.waitFor();
    await page.getByRole('heading', { name: 'Make it you.', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${output}/${type.name()}-desktop.png` });
    for (const view of ['face', 'shoes', 'outfit']) {
      const preset = page.getByRole('button', { name: `View ${view}`, exact: true });
      await preset.click();
      assert.equal(await preset.getAttribute('aria-pressed'), 'true');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${output}/${type.name()}-${view}.png` });
    }
    await page.getByRole('button', { name: 'Skin tone 3', exact: true }).click();
    await page.getByRole('button', { name: 'Outfit colour 3', exact: true }).click();
    await page.getByRole('button', { name: 'Rotate character left', exact: true }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/${type.name()}-jacket-angle.png` });
    await page.getByRole('button', { name: 'Rotate character right', exact: true }).click();
    checks.push(`${type.name()}: face, shoes and outfit views, colour selection and rotation`);
    console.log(`${type.name()}: desktop and character controls captured`);

    const name = page.getByRole('textbox', { name: 'Your name', exact: true });
    for (const [label, width, height] of [['portrait', 390, 844], ['small-phone', 320, 568], ['landscape', 844, 390]] as const) {
      await page.setViewportSize({ width, height });
      await page.locator('.custom-options').evaluate(node => node.scrollTop = 0);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No page overflow');
      assert.equal(await page.locator('.custom-options').evaluate(node => node.scrollWidth > node.clientWidth + 1), false, 'No horizontal scroll inside appearance options');
      await visibleTarget(join, width, height);
      for (const label of ['Skin tone 3', 'Outfit colour 3']) {
        const swatch = page.getByRole('button', { name: label, exact: true });
        await swatch.click();
        await visibleTarget(swatch, width, height);
        assert.equal(await swatch.getAttribute('aria-pressed'), 'true');
        await visibleTarget(join, width, height);
      }
      for (const control of await page.locator('.preview-controls button').all()) await visibleTarget(control, width, height);
      await name.scrollIntoViewIfNeeded();
      await name.click();
      await name.fill('Soft Corner check');
      await visibleTarget(name, width, height);
      await visibleTarget(join, width, height);
      await name.blur();
      await page.locator('.custom-options').evaluate(node => node.scrollTop = 0);
      await page.screenshot({ path: `${output}/${type.name()}-${label}.png` });
      await page.getByRole('button', { name: 'View face', exact: true }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${output}/${type.name()}-${label}-face.png` });
      await page.getByRole('button', { name: 'View outfit', exact: true }).click();
      checks.push(`${type.name()}: ${label}, touch targets, editable name, scrollable options and persistent join button`);
      console.log(`${type.name()}: ${label} passed`);
    }
    await page.setViewportSize({ width: 1656, height: 950 });
    await name.focus();
    // Native macOS WebKit uses Option-Tab to include buttons in keyboard traversal.
    await name.press(type === webkit && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
    assert.equal(await join.evaluate(node => document.activeElement === node), true, 'Keyboard tab from name reaches Join');
    await join.press('Enter');
    await page.getByRole('button', { name: 'Open town map', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Wave to neighbours', exact: true }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${output}/${type.name()}-in-town.png` });
    await page.reload();
    await choose.waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'What should we call you?', exact: true }).inputValue(), 'Soft Corner check');
    await choose.click();
    await join.waitFor();
    for (const label of ['Skin tone 3', 'Outfit colour 3']) assert.equal(await page.getByRole('button', { name: label, exact: true }).getAttribute('aria-pressed'), 'true', 'Appearance persists after joining and reloading');
    checks.push(`${type.name()}: keyboard join, wave, saved name and appearance after reload`);
  } finally { await browser.close(); }
}
assert.deepEqual(errors, [], 'No browser runtime errors');
await writeFile(`${output}/results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), graphics: 'medium', checks, errors, limits: 'Headless Chromium and WebKit with emulated viewport/touch sizes. This does not establish physical phone performance.' }, null, 2));
checks.forEach(check => console.log(`PASS: ${check}`));
