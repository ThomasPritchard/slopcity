import { webkit, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import type { BlackjackView, CasinoPrivateState, CasinoTableView, RouletteView, SlotsView } from '../shared/casino.ts';
import type { PokerView } from '../shared/poker.ts';
import { resolveCraps, type CrapsView } from '../shared/craps.ts';
import { rouletteChoices } from '../src/casino/rouletteChoices.ts';

// Real React components with controlled state. Protocol/settlement are checked separately.
const output = 'output/playwright/casino-improvements';
await mkdir(output, { recursive: true });
const fixture = `${output}/ui-fixture.tsx`, html = `${output}/ui-fixture.html`;
await writeFile(html, '<div id="root"></div><script type="module" src="./ui-fixture.tsx"></script>');
await writeFile(fixture, `import React from 'react';import{createRoot}from'react-dom/client';import{CasinoPanel}from'/src/casino/CasinoPanel';import{CasinoResultAnnouncement}from'/src/casino/CasinoResultAnnouncement';import{TownChat}from'/src/ui/TownChat';import'/src/style.css';import'/src/ui/quiet-glass.css';
const root=createRoot(document.getElementById('root'));window.commands=[];window.fixtureClosed=false;window.present=(value)=>{window.fixture=value;root.render(<main className="game playing at-table"><CasinoPanel open={true} {...value} chat={value.chatOpen?<aside className="casino-chat is-open"><TownChat messages={Array.from({length:12},(_,i)=>({id:String(i),name:'Neighbour',body:'Hello from the table. Good luck with your next round!'}))} message="Hello town" name="Alice" colour="#567755" population={6} silenced={false} silencedSeconds={0} inputRef={React.createRef()} onChange={()=>{}} onSubmit={event=>event.preventDefault()} onFocus={()=>{}} onBlur={()=>{}} onClose={()=>{}}/></aside>:null} onCommand={command=>window.commands.push(command)} onClose={()=>{window.fixtureClosed=true}}/><CasinoResultAnnouncement state={{serverTime:value.serverTime,tables:[value.table]}} privateState={value.privateState} profileId="alice" atTable={true}/></main>)};window.ready=true;`);
const browser = await webkit.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(10000);
await page.addInitScript('window.__name = value => value');
const errors: string[] = [], checks: string[] = [], failures: string[] = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
const player = { profileId: 'alice', name: 'Alice', connected: true };
const roulette: RouletteView = { id: 'roulette-1', game: 'roulette', roundId: 'roulette-fixture', phase: 'betting', deadline: 0, betCount: 0, result: null, history: [2, 4, 6, 8, 0, 11, 20, 31, 14, 23, 3, 17], motion: null, readiness: { players: 1, readyProfileIds: [], deadline: 0 } };
const bets: CasinoPrivateState = { rouletteBets: Array.from({ length: 20 }, (_, index) => ({ tableId: roulette.id, roundId: roulette.roundId, wagerId: `bet-${index}`, bet: { kind: 'straight', numbers: [index], stake: 10 } })) };
const empty: CasinoPrivateState = { rouletteBets: [] };
const blackjack: BlackjackView = { id: 'blackjack-1', game: 'blackjack', roundId: 'blackjack-fixture', phase: 'playing', deadline: 0, dealer: [{ rank: '9', suit: 'hearts' }, null], dealerTotal: null, activeSeat: 0, activeHand: 0, seats: Array.from({ length: 5 }, (_, seat) => ({ seat, player: seat === 0 ? player : { profileId: `other-${seat}`, name: `Neighbour ${seat}`, connected: true }, hands: [
  { cards: [{ rank: '8', suit: 'hearts' }, { rank: '3', suit: 'spades' }], stake: 20, total: 11, soft: false, state: 'playing', actions: ['hit', 'stand', 'double'] },
  { cards: Array.from({ length: 8 }, () => ({ rank: 'A', suit: 'clubs' })), stake: 10, total: 18, soft: true, state: 'stood', actions: [] },
] })) };
const slots: SlotsView = { id: 'slots-1', game: 'slots', roundId: 'slots-fixture', phase: 'idle', deadline: 0, player: null, reels: [], stake: 0, returned: null };
const craps: CrapsView = { id: 'craps-1', game: 'craps', roundId: 'craps-fixture', rollId: 'roll-fixture', phase: 'betting', deadline: 0, point: null, shooter: null, betCount: 0, result: null, history: [], motion: null };
const poker: PokerView = { id: 'poker-1', game: 'poker', roundId: 'poker-fixture', handId: 'poker-fixture', phase: 'river', deadline: 0, button: 0, smallBlindSeat: 1, bigBlindSeat: 2, activeSeat: 0, board: [{ rank: 'A', suit: 'hearts' }, { rank: 'K', suit: 'spades' }, { rank: 'Q', suit: 'clubs' }, { rank: 'J', suit: 'diamonds' }, { rank: '10', suit: 'hearts' }], pot: 500, currentBet: 40, seats: Array.from({ length: 6 }, (_, seat) => ({ seat, player: seat === 0 ? player : { profileId: `poker-${seat}`, name: `Neighbour ${seat}`, connected: true }, stack: 500, bet: 20, committed: 60, state: 'playing', leaving: false, cards: [null, null] })), pots: [], winners: [], message: 'Your turn' };
const pokerPrivate: CasinoPrivateState = { ...empty, poker: { tableId: 'poker-1', escrowId: 'fixture-escrow', seat: 0, handId: 'poker-fixture', holeCards: [{ rank: 'A', suit: 'clubs' }, { rank: 'A', suit: 'spades' }], canRejoin: false, actions: { turnId: 'turn-fixture', canFold: true, canCheck: false, canCall: true, callAmount: 20, canRaise: true, minRaiseTo: 80, maxRaiseTo: 520, canAllIn: true } } };

async function present(table: CasinoTableView, privateState = empty, extra = {}) {
  await page.evaluate(value => (window as any).present(value), { open: true, table: { ...table, deadline: Date.now() + 3600000 }, serverTime: Date.now(), profileId: 'alice', balance: 1000, privateState, busy: false, error: '', notice: 'Accepted', ...extra });
  await page.locator('.casino-panel').waitFor();
  await page.waitForTimeout(50);
}
async function fit(label: string) {
  label = `${page.viewportSize()!.width}x${page.viewportSize()!.height} ${label}`;
  const problems = await page.evaluate(() => {
    const findings: string[] = [];
    const panel = document.querySelector<HTMLElement>('.casino-panel')!;
    for (const element of panel.querySelectorAll<HTMLElement>('button,input,select,p,h3,.casino-stage,.casino-body,.casino-card,.casino-page-nav,.casino-personal-result')) {
      if (!element.getClientRects().length || element.closest('.sr-only')) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const label = `${element.className || element.tagName} ${(element.textContent ?? '').trim().slice(0, 45)}`;
      if (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1) findings.push(`${label}: outside viewport`);
      if (element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 2 && !element.classList.contains('casino-card')) findings.push(`${label}: vertical overflow ${element.scrollHeight}/${element.clientHeight}`);
      let ancestor = element.parentElement;
      while (ancestor && panel.contains(ancestor)) {
        const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll)/.test(style.overflowY) && (rect.top < box.top - 2 || rect.bottom > box.bottom + 2)) { findings.push(`${label}: clipped vertically by ${ancestor.className}`); break; }
        if (/(hidden|clip|auto|scroll)/.test(style.overflowX) && (rect.left < box.left - 2 || rect.right > box.right + 2)) { findings.push(`${label}: clipped horizontally by ${ancestor.className}`); break; }
        ancestor = ancestor.parentElement;
      }
    }
    if (document.documentElement.scrollWidth > innerWidth) findings.push('Document horizontal overflow');
    return [...new Set(findings)];
  });
  if (problems.length) { failures.push(`${label}: ${problems.join('; ')}`); await page.screenshot({ path: `${output}/overflow-${failures.length}.png` }); }
  else checks.push(label);
}
async function pages(label: string) {
  const next = page.getByRole('button', { name: `Next ${label.toLowerCase()} page`, exact: true });
  let count = 1;
  await fit(`${label} page ${count}`);
  while (await next.count() && await next.isEnabled()) { try { await next.click({ timeout: 700 }); } catch { failures.push(`${page.viewportSize()!.width}x${page.viewportSize()!.height} ${label}: next page is blocked`); break; } await fit(`${label} page ${++count}`); assert.ok(count <= 25); }
}
async function chooseStage(group: string, label: string, value: string) {
  const select = page.locator(`select[aria-label="${group}"]`);
  if (await select.isVisible()) await select.selectOption(value);
  else await page.getByRole('button', { name: label, exact: true }).click();
}
try {
  await page.goto(`http://localhost:5173/${html}`); await page.waitForFunction(() => (window as any).ready);
  for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 960 }, portrait: { width: 390, height: 844 }, landscape: { width: 844, height: 390 }, small: { width: 375, height: 667 } })) {
    if (process.env.CASINO_UX_VIEWPORT && process.env.CASINO_UX_VIEWPORT !== name) continue;
    await page.setViewportSize(viewport);
    for (const [game, privateState] of [[roulette, bets], [blackjack, empty], [slots, empty], [craps, empty], [poker, pokerPrivate]] as const) {
      await present(game, privateState);
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await fit(`${name} ${game.game} Play`);
      await present(game,privateState,{chatOpen:true}); await fit(`${name} ${game.game} with chat`);
      const chatProblems = await page.evaluate(()=>{
        const panel=document.querySelector('.casino-panel')!.getBoundingClientRect(), chat=document.querySelector('.casino-chat')!.getBoundingClientRect();
        const issues=[];
        if(!(chat.right<=panel.left||chat.bottom<=panel.top)) issues.push('Chat overlaps game controls');
        for(const element of document.querySelectorAll('.casino-chat button,.casino-chat input')) { const box=element.getBoundingClientRect(); if(box.height<44||box.width<44||box.top<0||box.bottom>innerHeight||box.left<0||box.right>innerWidth)issues.push('Chat control clipped or below44px'); }
        return issues;
      });
      assert.deepEqual(chatProblems,[],`${name} ${game.game} chat layout`);
      await page.screenshot({path:`${output}/${game.game}-chat-${name}.png`});
      await present(game,privateState);
      await page.screenshot({ path: `${output}/${game.game}-${name}.png` });
      await page.getByRole('button', { name: 'How to play', exact: true }).click(); await pages('Rules');
      await page.getByRole('button', { name: 'Results', exact: true }).click(); await fit(`${name} ${game.game} Results`);
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      if (game.game === 'roulette') {
        await chooseStage('Roulette choices', 'Numbers', 'numbers'); await pages('Numbers');
        await chooseStage('Roulette choices', 'More bets', 'more'); await page.locator('.casino-fields select').first().selectOption('split'); await fit(`${name} split selector`);
        await chooseStage('Roulette choices', 'Your bets (20)', 'bets'); await pages('Bet');
      }
      if (game.game === 'blackjack') { await chooseStage('Blackjack views', 'Hand 2', 'hand2'); await fit(`${name} split hand many cards`); const next = page.getByRole('button', { name: 'Next cards', exact: true }); while (await next.isEnabled()) { try { await next.click({ timeout: 700 }); } catch { failures.push(`${name} next cards blocked`); break; } await fit(`${name} split cards page`); } await chooseStage('Blackjack views', 'At the table (5/5)', 'table'); await pages('Table hand'); }
      if (game.game === 'poker') {
        await chooseStage('Poker views', 'Players (6/6)', 'table'); await pages('Seat');
        await chooseStage('Poker views', 'Community cards', 'hand');
        const raise = page.getByRole('button', { name: 'Raise…', exact: true });
        if (await raise.count()) { await raise.click(); await fit(`${name} poker raise stage`); }
      }
    }
    const winningPrivate: CasinoPrivateState = { rouletteBets: [{ tableId: roulette.id, roundId: `win-${name}`, wagerId: `win-${name}`, bet: { kind: 'red', numbers: rouletteChoices('red')[0], stake: 10 } }] };
    await present({ ...roulette, roundId: `win-${name}`, phase: 'landing', result: 1 }, winningPrivate);
    assert.equal(await page.locator(`[data-result-id="roulette-1:win-${name}"]`).count(), 0, 'No pre-landing win announcement');
    await present({ ...roulette, roundId: `win-${name}`, phase: 'result', result: 1 }, winningPrivate);
    await page.locator('.casino-result-announcement[data-net="10"]').waitFor();
    await page.screenshot({ path: `${output}/win-${name}.png` });
    await present({ ...roulette, roundId: `win-${name}`, phase: 'result', result: 1 }, winningPrivate, {chatOpen:true});
    const resultBox=(await page.locator('.casino-result-announcement[data-net="10"]').boundingBox())!;
    const chatBox=(await page.locator('.casino-chat .chat-panel').boundingBox())!;
    assert.ok(resultBox.x+resultBox.width<=chatBox.x || chatBox.x+chatBox.width<=resultBox.x || resultBox.y+resultBox.height<=chatBox.y || chatBox.y+chatBox.height<=resultBox.y,`${name}: win announcement leaves chat readable`);
    await page.screenshot({path:`${output}/win-with-chat-${name}.png`});
    await page.getByRole('button', { name: 'Results', exact: true }).click(); await fit(`${name} personal result`);
    await present({ ...slots, roundId: `spin-${name}`, phase: 'result', player, stake: 10, returned: 10, reels: ['cherry', 'cherry', 'bar'] });
    assert.equal(await page.getByRole('button', { name: 'Spin for 10 credits', exact: true }).isEnabled(), true, 'Owner can spin during result');
    await fit(`${name} slots immediately replayable`);
    await present({ ...craps, phase: 'result', result: resolveCraps([4, 3], null) }, { ...empty, crapsBets: [{ tableId: 'craps-1', roundId: craps.roundId, wagerId: `craps-${name}`, bet: { kind: 'pass', stake: 10 } }] });
    await fit(`${name} craps result`);
    await present(roulette, bets, { error: 'Betting has closed. Wait for the next round before placing a new bet.' });
    await page.getByRole('alert').waitFor(); await fit(`${name} complete error message`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await fit(`${name} error explanation`);
    await chooseStage('Roulette choices', 'Numbers', 'numbers'); await fit(`${name} numbers with error`);
    await chooseStage('Roulette choices', 'Your bets (20)', 'bets'); await fit(`${name} accepted bets with error`);
    await present(roulette, bets, { busy: true }); await chooseStage('Roulette choices', 'Numbers', 'numbers'); await fit(`${name} pending wager numbers`);
    await present(poker, pokerPrivate); await page.getByRole('button', { name: 'How to play', exact: true }).click();
    await page.getByRole('button', { name: 'Raise…', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Play', exact: true }).getAttribute('aria-pressed'), 'true'); await fit(`${name} raise from rules`);
  }
  await present({...roulette,roundId:'higher-stake'},empty);
  await page.getByLabel('Roulette stake',{exact:true}).fill('150');
  await page.getByRole('button',{name:'Place 150-credit bet',exact:true}).click();
  assert.equal(await page.evaluate(()=>(window as any).commands.at(-1).bet.stake),150);
  await page.getByLabel('Roulette stake',{exact:true}).fill('155');
  assert.equal(await page.getByRole('button',{name:'Use 10-credit steps',exact:true}).isDisabled(),true);
  await page.getByLabel('Roulette stake',{exact:true}).fill('');
  assert.equal(await page.getByRole('button',{name:'Use 10-credit steps',exact:true}).isDisabled(),true);
  await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => (window as any).fixtureClosed), true);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/ui-results.json`, JSON.stringify({ checks, failures, errors, scope: 'Headless WebKit React fixture: four viewports, all five games, rules/bets/numbers pagination, split cards, poker raise, result reveal and slot re-spin controls.' }, null, 2));
  assert.deepEqual(failures, []);
  console.log(`PASS: ${checks.length} casino UI page/layout checks across all five games at the selected viewports; no clipping, scrolling or page errors.`);
} catch (error) { await writeFile(`${output}/ui-results.json`, JSON.stringify({ checks, failures, errors, interrupted: String(error) }, null, 2)); console.error(errors); console.error((await page.locator('body').innerText()).slice(-2000)); await page.screenshot({ path: `${output}/ui-check-failure.png` }); throw error; }
finally { await browser.close(); await rm(fixture, { force: true }); await rm(html, { force: true }); }
