import { webkit,chromium,type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { ROULETTE_ORDER } from '../shared/rouletteMotion.ts';
await mkdir('output/playwright',{recursive:true});
const compact=process.env.CASINO_BROWSER==='chromium';
const browser=await(compact?chromium:webkit).launch({headless:true});
const page=await browser.newPage({viewport:compact?{width:960,height:720}:{width:1440,height:960},hasTouch:!compact});
page.setDefaultTimeout(45000);
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const wallet=()=>page.evaluate(async()=>await(await fetch('/game/api/economy')).json());
async function position(){await page.getByRole('button',{name:'Open town map'}).click();const mark=page.locator('.town-map circle[fill="#253d33"]');const p={x:Number(await mark.getAttribute('cx')),z:-Number(await mark.getAttribute('cy'))};await page.getByRole('button',{name:'Close panel'}).click();return p;}
async function walk(axis:'x'|'z',target:number){for(let i=0;i<(compact?48:20);i++){const delta=target-(await position())[axis];if(Math.abs(delta)<.30)return;const key=axis==='x'?(delta>0?'d':'a'):(delta>0?'w':'s');await page.locator('#world').focus();await page.keyboard.down(key);await page.waitForTimeout(Math.min(1600,Math.max(65,Math.abs(delta)/4.2*1000)));await page.keyboard.up(key);await page.waitForTimeout(180);}throw Error(`Could not walk to ${axis}=${target}`);}
async function enabled(name:string){const button=page.getByRole('button',{name,exact:true});await button.waitFor();await page.waitForFunction(name=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===name);return button&&!button.disabled;},name,{timeout:50000});return button;}
async function shot(name:string){await page.waitForFunction(()=>{const w=(window as any).casinoScene?.activeCamera;if(!w)return false;const v=w.viewport;return document.querySelector('.casino-panel')&&innerWidth<700&&innerHeight>innerWidth?v.y===.55:v.y===0;});await page.waitForTimeout(350);await page.screenshot({path:`output/playwright/${name}.png`});}
async function mobileLayout(game:string,action:string){
 for(const [orientation,viewport]of [['portrait',{width:390,height:844}],['landscape',{width:844,height:390}]] as const){
  await page.setViewportSize(viewport);await page.waitForTimeout(200);
  const box=await page.getByRole('button',{name:action,exact:true}).boundingBox();assert.ok(box&&box.height>=44&&box.y>=0&&box.y+box.height<=viewport.height&&box.x>=0&&box.x+box.width<=viewport.width,`${game} ${orientation} action stays on screen`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await shot(`casino-${game}-mobile-${orientation}`);
 }
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);
}

try{
 await page.goto('http://localhost:5173');await page.getByRole('textbox',{name:'WHAT SHOULD WE CALL YOU?'}).fill('Tom');await page.getByRole('button',{name:'Enter',exact:true}).click();await page.getByRole('button',{name:'Join the square',exact:true}).click();await page.getByRole('button',{name:'Open town map'}).waitFor();const welcome=page.getByRole('button',{name:'Dismiss welcome'});if(await welcome.isVisible())await welcome.click();
 if(compact){await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('checkbox',{name:/Performance mode/}).check();await page.getByRole('button',{name:'Close panel'}).click();}
 await page.evaluate(async()=>{const path='/node_modules/.vite/deps/@babylonjs_core_Engines_engine.js';const{Engine}=await import(path);(window as any).casinoScene=Engine.Instances[0].scenes[0];});
 assert.equal((await wallet()).balance,1000);
 await walk('x',-4.7);await walk('z',11.2);await walk('x',0);await walk('z',29.6);
 console.log('Reached roulette through the town and entrance.');
 await page.getByRole('button',{name:'Open European roulette · Table 1',exact:true}).click();
 if(!compact)await mobileLayout('roulette','Place 10-credit bet');
 await page.waitForFunction(()=>Number.parseInt(document.querySelector('.casino-countdown')?.textContent??'0')>8&&[...document.querySelectorAll('button')].some(b=>b.textContent==='Place 10-credit bet'&&!b.disabled),undefined,{timeout:50000});
 await(await enabled('Place 10-credit bet'))[compact?'click':'tap']();await page.locator('.casino-your-bets li').waitFor();assert.equal((await wallet()).balance,990);assert.equal(await page.evaluate(()=>(window as any).casinoScene.getMeshByName('casino-chip-roulette-1-own-0')?.isEnabled()),true);
 if(!compact)await page.setViewportSize({width:1440,height:960});
 await page.locator('.casino-body').evaluate(node=>node.scrollTop=0);await shot(compact?'casino-chromium-roulette':'34-casino-roulette');
 await page.getByText('THE BALL IS SETTLING',{exact:true}).waitFor();assert.equal(await page.locator('.roulette-winning-number').count(),0,'The result announcement waits for the physical landing');
 await page.locator('.roulette-winning-number').waitFor();const number=Number(await page.locator('.roulette-winning-number').innerText());assert.equal((await wallet()).balance,number===0?1350:990);
 const pocketError=await page.evaluate(index=>{const scene=(window as any).casinoScene,wheel=scene.getTransformNodeByName('roulette-wheel-instance'),ball=scene.getMeshByName('Ivory roulette ball roulette-1'),marker=wheel.getChildTransformNodes().find((n:any)=>n.name.endsWith('/ball-pocket-0'));marker.computeWorldMatrix(true);const V=scene.activeCamera.target.constructor,p=marker.position,a=index/37*Math.PI*2;return V.Distance(ball.position,V.TransformCoordinates(new V(p.x*Math.cos(a)+p.z*Math.sin(a),p.y,p.z*Math.cos(a)-p.x*Math.sin(a)),marker.parent.getWorldMatrix()));},ROULETTE_ORDER.indexOf(number as typeof ROULETTE_ORDER[number]));
 assert.ok(pocketError<.003,`Announced winning number matches the actual recessed pocket: ${pocketError}`);
 console.log('Roulette accepted, debited and settled against visible result.');
 if(compact){assert.deepEqual(errors,[]);console.log('PASS: headless Chromium startup, real walk, roulette play and settlement.');}
 else {
 await page.getByRole('button',{name:'Close casino table'}).click();await walk('z',27);await walk('x',-8);
 await page.getByRole('button',{name:'Open Blackjack · Table 1',exact:true}).click();await page.getByRole('button',{name:'Take seat 3',exact:true}).click();await page.getByRole('button',{name:'Leave seat',exact:true}).waitFor();
 const before=await wallet();await enabled('Bet 10 credits');await mobileLayout('blackjack','Bet 10 credits');await(await enabled('Bet 10 credits')).tap();await page.getByText('Your bet is placed. Cards are dealt when betting closes.',{exact:true}).waitFor();assert.equal((await wallet()).balance,before.balance-10);
 await page.waitForFunction(()=>!!document.querySelector('.blackjack-hand .casino-card'),undefined,{timeout:30000});await page.waitForTimeout(450);
 assert.ok(await page.evaluate(()=>(window as any).casinoScene.meshes.filter((m:any)=>m.name.startsWith('casino-card-blackjack-1')&&m.isEnabled()).length)>=4);
 await shot('casino-blackjack-mobile-playing');await page.setViewportSize({width:1440,height:960});await page.locator('.casino-body').evaluate(node=>node.scrollTop=0);await shot('35-casino-blackjack');
 const hit=page.getByRole('button',{name:'Hit',exact:true});if(await hit.isVisible()&&await hit.isEnabled()){
   const cardCount=await page.locator('.blackjack-hands .casino-card').count();await hit.click();await page.waitForFunction(count=>document.querySelectorAll('.blackjack-hands .casino-card').length>count,cardCount);
   await page.waitForTimeout(400);assert.ok(await page.evaluate(()=>(window as any).casinoScene.meshes.filter((m:any)=>m.name.startsWith('casino-card-blackjack-1-2-0-')&&m.isEnabled()).length)>cardCount);
 }

 const stand=page.getByRole('button',{name:'Stand',exact:true});if(await stand.isVisible() && await stand.isEnabled())await stand.click();
 await page.locator('.casino-round-status', {hasText:'Round complete'}).first().waitFor();const outcome=page.locator('.blackjack-hand-outcome').first();const returned=await outcome.locator('strong').count()?Number((await outcome.locator('strong').innerText()).replace(/[^0-9]/g,'')):0;assert.equal((await wallet()).balance,before.balance-10+returned);
 await(await enabled('Leave seat')).click();await page.locator('.casino-panel').waitFor({state:'detached'});
 console.log('Blackjack seated, dealt, action/result settled and seat released.');
 await walk('z',26.7);await walk('x',-14.6);
 await page.getByRole('button',{name:'Open Meridian reels · 1',exact:true}).click();const slotBefore=(await wallet()).balance;
 await enabled('Spin for 10 credits');await mobileLayout('slots','Spin for 10 credits');await(await enabled('Spin for 10 credits')).tap();await page.getByRole('group',{name:'Reels spinning'}).waitFor();await page.getByRole('button',{name:'Next spin shortly',exact:true}).waitFor();
 const line=await page.locator('.slots-result strong').innerText();const slotReturned=line==='Stake returned'?10:line==='No winning line'?0:Number(line.replace(/[^0-9]/g,''));assert.equal((await wallet()).balance,slotBefore-10+slotReturned);
 await page.setViewportSize({width:1440,height:960});await page.locator('.casino-body').evaluate(node=>node.scrollTop=0);await shot('36-casino-slots');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);await shot('37-casino-mobile');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const panel=await page.locator('.casino-panel').boundingBox();assert.ok(panel && panel.y>=360 && panel.y+panel.height<=845);
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: headless WebKit roulette, blackjack, slots, credit settlement, real walking/seating, mobile layout and Escape; no page errors.');
 }
 await writeFile(`output/playwright/casino-${compact?'chromium':'webkit'}-results.json`,JSON.stringify({checkedAt:new Date().toISOString(),browser:compact?'headless Chromium':'headless WebKit',errors,balance:(await wallet()).balance},null,2));
}catch(error){console.log((await page.locator('body').innerText()).slice(-4500));await shot('casino-browser-failure').catch(()=>{});throw error;}finally{await browser.close();}
