import { webkit, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Two real local guests; no injected wallets, positions or game outcomes.
const output = 'output/playwright/casino-qol';
await mkdir(output, { recursive: true });
const browser = await webkit.launch({ headless: true });
const pages: Page[] = [], errors: string[] = [], checks: string[] = [];
async function join(name: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(45000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:5173');
  await page.getByRole('textbox', { name: 'WHAT SHOULD WE CALL YOU?' }).fill(name);
  await page.getByRole('button', { name: 'Enter', exact: true }).click();
  await page.getByRole('button', { name: 'Join the square', exact: true }).click();
  await page.getByRole('button', { name: 'Open town map', exact: true }).first().waitFor();
  const welcome = page.getByRole('button', { name: 'Dismiss welcome', exact: true }); if (await welcome.isVisible()) await welcome.click();
  await page.getByRole('button', { name: 'Toggle town chat', exact: true }).click();
  assert.equal(await page.getByLabel('Message to town').count(), 0);
  await page.keyboard.press('/');
  assert.equal(await page.getByLabel('Message to town').evaluate(input => document.activeElement === input), true);
  assert.equal(await page.getByLabel('Message to town').inputValue(), '');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByLabel('Message to town').count(), 0);
  return page;
}
async function position(page: Page) {
  await page.getByRole('button', { name: 'Open town map', exact: true }).first().click();
  const mark = page.locator('.town-map circle[fill="#253d33"]');
  const value = { x: Number(await mark.getAttribute('cx')), z: -Number(await mark.getAttribute('cy')) };
  await page.getByRole('button', { name: 'Close panel', exact: true }).click(); return value;
}
async function walk(page: Page, axis: 'x'|'z', target: number) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const delta = target - (await position(page))[axis]; if (Math.abs(delta) < .3) return;
    const key = axis === 'x' ? delta > 0 ? 'd' : 'a' : delta > 0 ? 'w' : 's';
    await page.locator('#world').focus(); await page.keyboard.down(key);
    await page.waitForTimeout(Math.min(1600, Math.max(65, Math.abs(delta) / 4.2 * 1000)));
    await page.keyboard.up(key); await page.waitForTimeout(180);
  }
  throw Error(`Could not reach ${axis}=${target}`);
}
async function send(page: Page, text: string) {
  await page.keyboard.press('/');
  const input = page.getByLabel('Message to town'); await input.fill(text); await input.press('Enter');
  await page.locator('.chat-history p', { hasText: text }).waitFor();
}
try {
  const a = await join('Casino QOL A'), b = await join('Casino QOL B');
  checks.push('Slash opens/focuses chat without inserting a slash; Escape returns to the town.');
  const salary = await a.locator('.salary-countdown').innerText();
  assert.match(salary, /\+100 in [0-4]:\d{2}|\+100 in 5:00/); checks.push(`Five-minute salary HUD: ${salary}`);
  for (const [axis,target] of [['x',-4.7],['z',11.2],['x',0],['z',29.6]] as const) await walk(a,axis,target);
  await a.getByRole('button',{name:'Open European roulette · Table 1',exact:true}).click();
  await a.getByRole('button',{name:'Open town chat',exact:true}).waitFor();
  await a.keyboard.press('/');
  const input = a.getByLabel('Message to town');
  assert.equal(await input.evaluate(node=>node===document.activeElement),true);
  await input.fill('Draft'); await input.press('/'); assert.equal(await input.inputValue(),'Draft/','Slash inside a draft stays literal');
  await input.fill('hello from roulette'); await input.press('Enter');
  await b.keyboard.press('/'); await b.locator('.chat-history p',{hasText:'hello from roulette'}).waitFor();
  assert.equal(await a.locator('.casino-panel').count(),1); checks.push('Casino chat reaches another real guest without closing roulette.');
  await send(b,'hello back from the square'); await a.locator('.chat-history p',{hasText:'hello back from the square'}).waitFor();
  for (const [label, viewport] of [['desktop',{width:1440,height:960}],['portrait',{width:390,height:844}],['landscape',{width:844,height:390}],['small',{width:375,height:667}]] as const) {
    await a.setViewportSize(viewport); await a.waitForTimeout(250);
    const game = (await a.locator('.casino-panel').boundingBox())!;
    const chat = (await a.locator('.casino-chat').boundingBox())!;
    assert.ok(chat.x+chat.width<=game.x+1 || chat.y+chat.height<=game.y+1,`${label}: chat leaves game controls uncovered`);
    for (const control of await a.locator('.casino-chat input,.casino-chat button,.casino-panel .casino-primary').all()) {
      const box=(await control.boundingBox())!; assert.ok(box.height>=44&&box.y>=0&&box.x>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,`${label}: control is visible and44px high`);
    }
    await a.screenshot({path:`${output}/roulette-chat-${label}.png`});
    await input.focus(); await input.press('Escape'); assert.equal(await a.locator('.chat-panel').count(),0); assert.equal(await a.locator('.casino-panel').count(),1);
    await a.getByRole('button',{name:'Open town chat',exact:true}).click();
    assert.equal(await input.evaluate(node=>node===document.activeElement),true);
    checks.push(`${label}: chat and roulette controls fit; Escape dismisses chat only; chat button focuses input.`);
  }
  // The dialog's keyboard loop includes chat controls.
  const last = a.getByRole('button',{name:'Send message',exact:true}); await input.fill('Keyboard check'); await last.focus(); await a.keyboard.press('Tab');
  assert.equal(await a.getByRole('button',{name:'Leave table',exact:true}).evaluate(node=>node===document.activeElement),true);
  await input.focus(); await input.press('Escape');
  await a.setViewportSize({width:1440,height:960});
  await a.getByLabel('Roulette stake',{exact:true}).fill('150');
  assert.equal(await a.locator('.chat-panel').count(),0,'Editing a stake does not open chat');
  const bet=a.getByRole('button',{name:'Place 150-credit bet',exact:true});
  await bet.waitFor(); await a.waitForFunction(()=>document.querySelector('.casino-primary')?.textContent==='Place 150-credit bet' && !(document.querySelector('.casino-primary') as HTMLButtonElement).disabled);
  const before=await a.evaluate(async()=> (await (await fetch('/game/api/economy')).json()).balance);
  await bet.click(); await a.getByRole('button',{name:'Your bets (1)',exact:true}).waitFor();
  const after=await a.evaluate(async()=> (await (await fetch('/game/api/economy')).json()).balance); assert.equal(after,before-150);
  await a.locator('.casino-ready').click(); await a.keyboard.press('/');
  await input.fill('watching the wheel together'); await input.press('Enter');
  await b.locator('.chat-history p',{hasText:'watching the wheel together'}).waitFor();
  await a.locator('.casino-result-announcement').waitFor();
  await a.screenshot({path:`${output}/roulette-settled-with-chat.png`});
  assert.equal(await a.locator('.casino-panel').count(),1);
  checks.push('Typed150-credit bet accepted/debited; chat works through Ready, spin and result.');
  assert.deepEqual(errors,[]);
  await writeFile(`${output}/results.json`,JSON.stringify({checkedAt:new Date().toISOString(),checks,errors,scope:'Two headless WebKit guests, actual local town and150-credit roulette wager; phone sizes emulated.'},null,2));
  console.log(`PASS: ${checks.length} QOL browser checks; slash, casino chat,150-credit roulette and salary HUD; no page errors.`);
} catch(error) { for(const [index,page]of pages.entries()){await page.screenshot({path:`${output}/failure-${index}.png`}).catch(()=>{}); console.log((await page.locator('body').innerText()).slice(-1500));}throw error; }
finally { await browser.close(); }
