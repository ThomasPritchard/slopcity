import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { webkit, type Page } from 'playwright';
import { FIRST_MEMORY, MEMORIES_BOARD } from '../shared/memories.ts';

const endpoint = process.env.GAME_URL || 'http://localhost:5173', output = 'output/playwright/community';
await mkdir(output,{ recursive:true });
const browser = await webkit.launch({ headless:true });
const errors:string[] = [], failures:string[] = [];
async function position(page:Page) {
 await page.getByRole('button',{name:'Open town map',exact:true}).first().click();
 const map=page.getByRole('dialog',{name:'Town map',exact:true}), marker=map.locator('.town-map circle[fill="#253d33"]');
 const p={x:Number(await marker.getAttribute('cx')),z:-Number(await marker.getAttribute('cy'))};
 await map.getByRole('button',{name:'Close panel',exact:true}).click();return p;
}
async function walk(page:Page,axis:'x'|'z',target:number) {
 for(let i=0;i<25;i++){
  const delta=target-(await position(page))[axis];if(Math.abs(delta)<.25)return;
  const key=axis==='x'?delta>0?'d':'a':delta>0?'w':'s';
  await page.locator('#world').focus();await page.keyboard.down(key);await page.waitForTimeout(Math.min(1600,Math.max(65,Math.abs(delta)/4.2*1000)));await page.keyboard.up(key);await page.waitForTimeout(180);
 }throw Error(`Walking failed: ${axis}=${target}`);
}
try{
 const context=await browser.newContext({viewport:{width:1440,height:960},hasTouch:true});
 await context.addInitScript(()=>{localStorage.setItem('slop-city-comfort',JSON.stringify({low:true,motion:'reduced',effects:0,ambience:0}));if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error('No voice in this check');};});
 const page=await context.newPage();page.setDefaultTimeout(60_000);
 page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{const path=new URL(response.url()).pathname;if(response.status()>=400&&!(path==='/game/api/profile'&&response.status()===401))failures.push(`${response.status()} ${path}`);});
 await page.goto(endpoint);await page.getByRole('button',{name:'Enter',exact:true}).waitFor({timeout:90_000});
 assert.equal(await page.getByRole('heading',{name:FIRST_MEMORY.welcome,exact:true}).count(),1);
 for(const [label,width,height] of [['desktop',1440,960],['portrait',390,844],['landscape',844,390]] as const){
  await page.setViewportSize({width,height});await page.locator('.welcome-layout').evaluate(node=>node.scrollTop=0);await page.waitForTimeout(300);
  await page.screenshot({path:`${output}/menu-${label}.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'Open our first community memory',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:FIRST_MEMORY.title,exact:true});await dialog.waitFor();
  assert.equal(await dialog.locator('img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth===1122),true);
  const close=await dialog.getByRole('button',{name:'Close memory'}).boundingBox();assert.ok(close&&close.height>=44&&close.y>=0&&close.y+close.height<=height);
  await page.screenshot({path:`${output}/memory-${label}.png`});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  assert.equal(await page.getByRole('button',{name:'Open our first community memory',exact:true}).evaluate(node=>node===document.activeElement),true);
 }
 await page.setViewportSize({width:1440,height:960});await page.getByRole('textbox',{name:'WHAT SHOULD WE CALL YOU?'}).fill('Memories check');
 await page.getByRole('button',{name:'Enter',exact:true}).click();await page.getByRole('button',{name:'Join the square',exact:true}).click();
 await page.getByRole('button',{name:'Open neighbours',exact:true}).waitFor();
 const welcome=page.getByRole('button',{name:'Dismiss welcome',exact:true});if(await welcome.isVisible())await welcome.click();
 await walk(page,'x',MEMORIES_BOARD.x);await walk(page,'z',MEMORIES_BOARD.z-2.7);
 await page.getByRole('button',{name:'Read the memories board',exact:true}).click();
 await page.getByRole('dialog',{name:FIRST_MEMORY.title,exact:true}).getByRole('button',{name:'Close memory'}).click();
 await page.locator('#world').focus();await page.keyboard.down('w');await page.waitForTimeout(1000);await page.keyboard.up('w');await page.waitForTimeout(250);
 const stopped=await position(page);assert.ok(stopped.z<MEMORIES_BOARD.z-.4&&stopped.z>MEMORIES_BOARD.z-.8,'Server and client stop at the physical board');
 if(endpoint.startsWith('http://localhost')){
  await page.evaluate(async board=>{
   const source=await(await fetch('/src/world/scene.ts')).text(),path=source.match(/import\s*\{\s*Engine\s*\}\s*from\s*["']([^"']+)/)?.[1];if(!path)throw Error('Cannot resolve renderer');
   const {Engine}=await import(path),scene=Engine.Instances[0].scenes[0],camera=scene.activeCamera;
   scene.onBeforeRenderObservable.add(()=>{camera.setTarget(new camera.target.constructor(board.x,1.7,board.z));camera.alpha=-Math.PI/2;camera.beta=1.43;camera.radius=5.3;});
  },MEMORIES_BOARD);
  await page.waitForTimeout(400);await page.screenshot({path:`${output}/square-board.png`});
  await page.mouse.click(640,445);await page.getByRole('dialog',{name:FIRST_MEMORY.title,exact:true}).waitFor();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
 await writeFile(`${output}/results.json`,JSON.stringify({checkedAt:new Date().toISOString(),endpoint,errors,failures,stopped,checks:['menu notice and original image','portrait/landscape scrolling and full-image dialog','Escape and restored focus','actual onboarding and square walk','shared/server board collision','nearby reading action',...(endpoint.startsWith('http://localhost')?['physical board click']:[])]},null,2));
 console.log('PASS: welcome news, supplied meme, responsive viewer, square memories board, movement collision and reading actions');
}catch(error){for(const context of browser.contexts())for(const page of context.pages())await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}finally{await browser.close();}
