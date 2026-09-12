import { webkit,chromium,type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { crapsReturn, resolveCraps } from '../shared/craps.ts';
await mkdir('output/playwright/craps',{recursive:true});
const compact=process.env.CRAPS_BROWSER==='chromium';
const browser=await(compact?chromium:webkit).launch({headless:true});
const page=await browser.newPage({viewport:compact?{width:960,height:720}:{width:1440,height:960},hasTouch:!compact});
page.setDefaultTimeout(45000);
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const wallet=()=>page.evaluate(async()=>await(await fetch('/game/api/economy')).json());
async function position(){await page.getByRole('button',{name:'Open town map'}).click();const mark=page.locator('.town-map circle[fill="#253d33"]');const p={x:Number(await mark.getAttribute('cx')),z:-Number(await mark.getAttribute('cy'))};await page.getByRole('button',{name:'Close panel'}).click();return p;}
async function walk(axis:'x'|'z',target:number){for(let i=0;i<(compact?48:20);i++){const delta=target-(await position())[axis];if(Math.abs(delta)<.30)return;const key=axis==='x'?(delta>0?'d':'a'):(delta>0?'w':'s');await page.locator('#world').focus();await page.keyboard.down(key);await page.waitForTimeout(Math.min(1600,Math.max(65,Math.abs(delta)/4.2*1000)));await page.keyboard.up(key);await page.waitForTimeout(180);}throw Error(`Could not walk to ${axis}=${target}`);}
async function enabled(name:string){const button=page.getByRole('button',{name,exact:true});await button.waitFor();await page.waitForFunction(name=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===name);return button&&!button.disabled;},name,{timeout:50000});return button;}
async function shot(name:string){await page.waitForFunction(()=>{const w=(window as any).casinoScene?.activeCamera;if(!w)return false;const v=w.viewport;return document.querySelector('.casino-panel')&&innerWidth<700&&innerHeight>innerWidth?v.y===.72:v.y===0;});await page.waitForTimeout(350);await page.screenshot({path:`output/playwright/${name}.png`});}
async function mobileLayout(game:string,action:string){
 for(const [orientation,viewport]of [['portrait',{width:390,height:844}],['landscape',{width:844,height:390}]] as const){
  await page.setViewportSize(viewport);await page.waitForTimeout(200);
  const box=await page.getByRole('button',{name:action,exact:true}).boundingBox();assert.ok(box&&box.height>=44&&box.y>=0&&box.y+box.height<=viewport.height&&box.x>=0&&box.x+box.width<=viewport.width,`${game} ${orientation} action stays on screen`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await shot(`casino-${game}-mobile-${orientation}`);
 }
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);
}

try {
 await page.goto('http://localhost:5173');
 await page.getByRole('textbox',{name:'What should we call you?'}).fill('Craps visitor');
 await page.getByRole('button',{name:'Choose your look',exact:true}).click(); await page.getByRole('button',{name:'Join the square',exact:true}).click();
 await page.getByRole('button',{name:'Open town map'}).waitFor(); const welcome=page.getByRole('button',{name:'Dismiss welcome'}); if(await welcome.isVisible())await welcome.click();
 await page.evaluate(async()=>{const path='/node_modules/.vite/deps/@babylonjs_core_Engines_engine.js';const{Engine}=await import(path);(window as any).casinoScene=Engine.Instances[0].scenes[0];});
 for(const [axis,target] of [['x',-4.7],['z',11.2],['x',0],['z',26.7],['x',-12],['z',48],['x',-11.5],['z',49.5]] as const) await walk(axis,target);
 await page.getByRole('button',{name:'Open Craps',exact:true}).click();
 console.log('Reached the physical craps table through the casino entrance and rear aisle.');
 await page.waitForFunction(()=>document.querySelector('.craps-game')?.getAttribute('data-phase')==='betting'&&Number.parseInt(document.querySelector('.casino-countdown')?.textContent??'0')>8);
 await page.getByRole('button',{name:/Don’t Pass 7 before the point/}).click();
 if(!compact)await mobileLayout('craps','Bet 10 on Don’t Pass');
 const before=(await wallet()).balance;
 await(await enabled('Bet 10 on Don’t Pass'))[compact?'click':'tap']();
 await page.getByRole('group', { name: 'Your accepted line', exact: true }).waitFor(); assert.equal((await wallet()).balance,before-10);
 assert.equal(await page.evaluate(()=>(window as any).casinoScene.getMeshByName('craps-live/chip-0')?.isEnabled()),true);
 const chips=await page.evaluate(()=>(window as any).casinoScene.getMeshByName('craps-live/chip-0').position.asArray());assert.ok(Math.abs(chips[2]-(51.4-.88))<.001,'Own chip matches chosen physical line');
 await page.setViewportSize({width:1440,height:960});await page.locator('.casino-body').evaluate(n=>n.scrollTop=0);await shot('craps/browser-wager');await page.locator('.casino-ready').click();
 let point: 4|5|6|8|9|10|null=null, terminal=false; const rolls=[];
 for(let roll=0;roll<60&&!terminal;roll++){
   await(await enabled('Roll dice')).click();
   await page.locator('.craps-game[data-phase="rolling"]').waitFor();
   assert.equal(await page.locator('.craps-total').count(),0,'No result announcement while dice move');
   if(roll===0)await shot('craps/browser-rolling');
   await page.locator('.craps-game[data-phase="result"]').waitFor();await page.waitForTimeout(100);
   const dice=await page.evaluate(()=>[0,1].map(index=>{const s=(window as any).casinoScene;return [1,2,3,4,5,6].map(value=>({value,y:s.getTransformNodeByName(`craps-face-${index}-${value}`).getAbsolutePosition().y})).sort((a,b)=>b.y-a.y)[0].value;})) as [number,number];
   const result=resolveCraps(dice,point);assert.equal(Number(await page.locator('.craps-total').innerText()),result.total,'UI total agrees with actual 3D top faces');
   const text=await page.locator('.craps-outcome-copy p').innerText();assert.ok(text.startsWith(`${dice[0]} + ${dice[1]} = ${result.total}.`),'UI individual dice agree with 3D faces');
   point=result.pointAfter;terminal=point===null;rolls.push(result);
   assert.equal((await wallet()).balance,before-10+(terminal?crapsReturn({kind:'dont-pass',stake:10},result):0));
   if(roll===0||terminal){await page.locator('.casino-body').evaluate(n=>n.scrollTop=0);await shot(terminal?'craps/browser-result':'craps/browser-point');}
 }
 assert.ok(terminal,'A shared line cycle completed');
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 assert.deepEqual(errors,[]);
 await writeFile(`output/playwright/craps/browser-${compact?'chromium':'webkit'}-results.json`,JSON.stringify({checkedAt:new Date().toISOString(),browser:compact?'headless Chromium':'headless WebKit',rolls,balance:(await wallet()).balance,errors},null,2));
 console.log('PASS: actual walk to craps, touch/portrait/landscape controls, accepted line chip, shared throw, UI/3D face agreement, point/terminal wallet settlement and Escape.');
}catch(error){console.log((await page.locator('body').innerText()).slice(-4500));await page.screenshot({path:'output/playwright/craps/browser-failure.png'}).catch(()=>{});throw error;}finally{await browser.close();}
