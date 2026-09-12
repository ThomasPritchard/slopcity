import { webkit, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const output = 'output/playwright';
await mkdir(output, {recursive:true});
const browser = await webkit.launch({headless:true});
const errors: string[] = [];
const endpoint = process.env.GAME_URL || 'http://localhost:5173';
async function join(page:Page,name:string) {
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(endpoint);
 await page.getByRole('textbox',{name:'What should we call you?'}).fill(name);
 await page.getByRole('button',{name:'Choose your look',exact:true}).click();
 await page.getByRole('button',{name:'Outfit colour 3',exact:true}).click();
 await page.getByRole('button',{name:'Join the square',exact:true}).click();
 await page.getByRole('button',{name:'Open town map',exact:true}).waitFor();
 await page.getByRole('button',{name:'Dismiss welcome'}).click();
}
async function position(page:Page) {
 await page.getByRole('button',{name:'Open town map'}).click();
 const mark=page.locator('.town-map circle[fill="#253d33"]');
 const p={x:Number(await mark.getAttribute('cx')),z:-Number(await mark.getAttribute('cy'))};
 await page.getByRole('button',{name:'Close panel'}).click();return p;
}
async function walk(page:Page,axis:'x'|'z',target:number) {
 for(let i=0;i<12;i++) {
  const delta=target-(await position(page))[axis];if(Math.abs(delta)<.4)return;
  const key=axis==='x'?(delta>0?'d':'a'):(delta>0?'w':'s');
  await page.locator('#world').focus();await page.keyboard.down(key);await page.waitForTimeout(Math.min(1600,Math.max(80,Math.abs(delta)/4.2*1000)));await page.keyboard.up(key);await page.waitForTimeout(250);
 }throw new Error(`Failed to walk to ${axis}=${target}`);
}
try {
 const context=await browser.newContext({viewport:{width:1440,height:960}});
 const page=await context.newPage();await join(page,'Tom');
 const saved=await page.evaluate(async()=>await(await fetch('/game/api/profile')).json());
 assert.equal(saved.shirt,2);assert.equal(saved.name,'Tom');
 const otherContext=await browser.newContext({viewport:{width:1000,height:800}});
 const other=await otherContext.newPage();await join(other,'Alex');
 await page.getByRole('button',{name:'Open neighbours'}).click();
 await page.getByRole('button',{name:'Mute Alex',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Mute Alex',exact:true}).getAttribute('aria-pressed'),'true');
 await page.screenshot({path:`${output}/20-neighbours.png`});
 await page.getByRole('button',{name:'Block Alex',exact:true}).click();
 await page.locator('.social-blocked-person').getByRole('button',{name:'Unblock Alex'}).waitFor();
 await other.getByRole('textbox',{name:'Message to town'}).fill('Blocked message check');await other.getByRole('button',{name:'Send message'}).click();
 await page.waitForTimeout(1000);assert.equal(await page.getByText('Blocked message check',{exact:false}).count(),0);
 await page.locator('.social-blocked-person').getByRole('button',{name:'Unblock Alex'}).click();
 await page.getByRole('button',{name:'Block Alex',exact:true}).waitFor();
 await other.getByRole('textbox',{name:'Message to town'}).fill('See you by the fountain.');await other.getByRole('button',{name:'Send message'}).click();
 await page.getByText('See you by the fountain.',{exact:false}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${output}/21-mobile-neighbours.png`});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 assert.equal(await page.getByRole('button',{name:'Open neighbours'}).evaluate(button=>document.activeElement===button),true);
 await page.setViewportSize({width:1440,height:960});
 await walk(page,'x',-7);await walk(page,'z',-8);await walk(page,'x',-10);
 await page.getByRole('button',{name:'Sit down',exact:true}).click();await page.getByRole('button',{name:'Stand up',exact:true}).waitFor();
 await page.waitForTimeout(1200);
 const seated=await position(page);
 await page.locator('#world').focus();await page.keyboard.down('w');await page.waitForTimeout(500);await page.keyboard.up('w');
 assert.deepEqual(await position(page),seated);assert.equal(await page.getByRole('button',{name:'Wave to neighbours'}).isDisabled(),true);
 await page.evaluate(async()=>{
  const source=await(await fetch('/src/world/scene.ts')).text();
  const path=source.match(/import\s*\{\s*Engine\s*\}\s*from\s*["']([^"']+)/)?.[1];
  if(!path)throw new Error('Could not resolve the actual renderer Engine');
  const{Engine}=await import(path);const scene=Engine.Instances[0].scenes[0];
  scene.activeCamera.alpha=-Math.PI/2+.4;scene.activeCamera.beta=1.35;scene.activeCamera.radius=4;
 });
 await page.waitForTimeout(800);await page.screenshot({path:`${output}/22-seated.png`});
 await page.getByRole('button',{name:'Stand up',exact:true}).click();await page.waitForTimeout(350);
 assert.equal(await page.getByRole('button',{name:'Wave to neighbours'}).isEnabled(),true);
 await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('button',{name:'Leave the square'}).click();
 await page.getByRole('textbox',{name:'What should we call you?'}).waitFor();await page.reload();
 await page.waitForFunction(()=>!(document.querySelector('#display-name') as HTMLInputElement)?.disabled);
 assert.equal(await page.getByRole('textbox',{name:'What should we call you?'}).inputValue(),'Tom');
 const restored=await page.evaluate(async()=>await(await fetch('/game/api/profile')).json());assert.equal(restored.id,saved.id);assert.equal(restored.shirt,2);
 assert.deepEqual(errors,[]);
 await writeFile(`${output}/social-results.json`,JSON.stringify({checkedAt:new Date().toISOString(),browser:'headless WebKit',checks:['saved guest restores','two guests and chat','mute toggle','persistent block/unblock and chat filtering','mobile dialog and focus restore','walk to bench','seated pose and movement suppression','stand','no runtime errors'],errors},null,2));
 console.log('PASS: saved guests, social controls, block/chat, mobile dialog, seated movement/stand and reload; no page errors.');
 await otherContext.close();await context.close();
} finally {await browser.close();}
