import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { webkit, type Page } from 'playwright';
import { FIRST_MEMORY, MEMORIES_BOARD } from '../shared/memories.ts';
import { SEATS } from '../shared/social.ts';
import { cinemaFloorHeight, inCinema } from '../shared/cinemaLayout.ts';

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
  const board=page.getByRole('dialog',{name:'Slop City memories',exact:true});await board.waitFor();
  const photo=board.getByRole('button',{name:`Open photo: ${FIRST_MEMORY.title}`,exact:true});await photo.click();
  const dialog=page.getByRole('dialog',{name:FIRST_MEMORY.title,exact:true});await dialog.waitFor();
  assert.equal(await dialog.locator('img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth===1122),true);
  const close=await dialog.getByRole('button',{name:'Close photo'}).boundingBox();assert.ok(close&&close.height>=44&&close.y>=0&&close.y+close.height<=height);
  await page.screenshot({path:`${output}/memory-${label}.png`});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  assert.equal(await photo.evaluate(node=>node===document.activeElement),true);
  await page.keyboard.press('Escape');await board.waitFor({state:'detached'});
  assert.equal(await page.getByRole('button',{name:'Open our first community memory',exact:true}).evaluate(node=>node===document.activeElement),true);
 }
 await page.setViewportSize({width:1440,height:960});await page.getByRole('textbox',{name:'WHAT SHOULD WE CALL YOU?'}).fill('Memories check');
 await page.getByRole('button',{name:'Enter',exact:true}).click();await page.getByRole('button',{name:'Join the square',exact:true}).click();
 await page.getByRole('button',{name:'Open neighbours',exact:true}).waitFor();
 const welcome=page.getByRole('button',{name:'Dismiss welcome',exact:true});if(await welcome.isVisible())await welcome.click();
 await walk(page,'x',MEMORIES_BOARD.x);await walk(page,'z',MEMORIES_BOARD.z-2.7);
 await page.getByRole('button',{name:'Examine the memories board',exact:true}).click();
 await page.getByRole('dialog',{name:'Slop City memories',exact:true}).getByRole('button',{name:'Close community'}).click();
 await page.locator('#world').focus();await page.keyboard.down('w');await page.waitForTimeout(1000);await page.keyboard.up('w');await page.waitForTimeout(250);
 const stopped=await position(page);assert.ok(stopped.z<MEMORIES_BOARD.z-.4&&stopped.z>MEMORIES_BOARD.z-.8,'Server and client stop at the physical board');
 console.log('PASS: responsive memory layers, restored focus and physical board collision');
 // Go around the solid board, then use the central garden ramp from the square.
 await walk(page,'x',-4.5);await walk(page,'z',-2);await walk(page,'x',-15.7);
 console.log('Reached the picture house through the central ramp');
 const cinemaPosition=await position(page);assert.ok(inCinema(cinemaPosition.x,cinemaPosition.z));
 await page.getByRole('button',{name:'Open town map',exact:true}).first().click();
 await page.getByRole('dialog',{name:'Town map',exact:true}).getByText('You are in The Bridge Picture House.',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Close panel',exact:true}).click();
 await page.getByRole('button',{name:'Visit the picture house',exact:true}).click();
 await page.getByRole('dialog',{name:'The Bridge Picture House',exact:true}).getByRole('button',{name:'Close community',exact:true}).click();
 await page.getByRole('button',{name:'Sit down',exact:true}).click();await page.getByRole('button',{name:'Stand up',exact:true}).waitFor();
 const seatPosition=await position(page),seat=SEATS.find(seat=>seat.benchId.startsWith('cinema-')&&Math.hypot(seat.x-seatPosition.x,seat.z-seatPosition.z)<.05);
 assert.ok(seat,'The server moved the guest onto a shared cinema seat anchor');
 const seatedAvatar=endpoint.startsWith('http://localhost')?await page.evaluate(async position=>{
  const source=await(await fetch('/src/world/scene.ts')).text(),path=source.match(/import\s*\{\s*Engine\s*\}\s*from\s*["']([^"']+)/)?.[1];if(!path)throw Error('Cannot resolve renderer');
  const {Engine}=await import(path),scene=Engine.Instances[0].scenes[0];
  const hit=scene.meshes.find((mesh:any)=>mesh.name.startsWith('player-hit:')&&mesh.parent&&Math.hypot(mesh.parent.position.x-position.x,mesh.parent.position.z-position.z)<.08);
  if(!hit)throw Error('Seated avatar root was not found');
  return {id:hit.parent.name,x:hit.parent.position.x,y:hit.parent.position.y,z:hit.parent.position.z,sit:scene.animationGroups.some((group:any)=>group.name.startsWith(hit.parent.name+'/')&&group.name.endsWith('/Sit')&&group.isStarted)};
 },seatPosition):null;
 if(seatedAvatar){assert.ok(Math.abs(seatedAvatar.y-cinemaFloorHeight(seat.x,seat.z))<.01,'Avatar root follows the authored cinema tier');assert.ok(seatedAvatar.sit,'The live guest uses the actual Sit clip');}
 await page.screenshot({path:`${output}/cinema-seated.png`});console.log('PASS: authoritative cinema seat, tier height and live Sit clip');
 const cinemaActionLayouts=[];
 for(const[label,width,height]of[['portrait',390,844],['landscape',844,390]]as const){
  await page.setViewportSize({width,height});await page.waitForTimeout(250);
  const seatAction=await page.getByRole('button',{name:'Stand up',exact:true}).boundingBox(),visitAction=await page.getByRole('button',{name:'Visit the picture house',exact:true}).boundingBox();
  assert.ok(seatAction&&visitAction);
  for(const box of[seatAction,visitAction])assert.ok(box.height>=44&&box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=height,'Cinema action is a visible phone touch target');
  assert.ok(seatAction.x+seatAction.width<=visitAction.x||visitAction.x+visitAction.width<=seatAction.x||seatAction.y+seatAction.height<=visitAction.y||visitAction.y+visitAction.height<=seatAction.y,'Cinema watch and seat actions do not overlap');
  cinemaActionLayouts.push({label,width,height,seatAction,visitAction});await page.screenshot({path:`${output}/cinema-actions-${label}.png`});
 }
 await page.setViewportSize({width:1440,height:960});
 await page.getByRole('button',{name:'Stand up',exact:true}).click();await page.getByRole('button',{name:'Stand up',exact:true}).waitFor({state:'detached'});
 const exitPosition=await position(page);assert.ok(Math.hypot(exitPosition.x-seat.exit.x,exitPosition.z-seat.exit.z)<.1,'Standing returns the guest to the server-selected bench exit');
 // Return through the central ramp to the original physical board for its click check.
 await walk(page,'z',-2);await walk(page,'x',-4.5);await walk(page,'z',MEMORIES_BOARD.z-1);await walk(page,'x',MEMORIES_BOARD.x);
 if(endpoint.startsWith('http://localhost')){
  await page.evaluate(async board=>{
   const source=await(await fetch('/src/world/scene.ts')).text(),path=source.match(/import\s*\{\s*Engine\s*\}\s*from\s*["']([^"']+)/)?.[1];if(!path)throw Error('Cannot resolve renderer');
   const {Engine}=await import(path),scene=Engine.Instances[0].scenes[0],camera=scene.activeCamera;
   scene.onBeforeRenderObservable.add(()=>{camera.setTarget(new camera.target.constructor(board.x,1.7,board.z));camera.alpha=-Math.PI/2;camera.beta=1.43;camera.radius=5.3;});
  },MEMORIES_BOARD);
  await page.waitForTimeout(400);await page.screenshot({path:`${output}/square-board.png`});
  await page.mouse.click(640,445);await page.getByRole('dialog',{name:'Slop City memories',exact:true}).waitFor();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
 await writeFile(`${output}/results.json`,JSON.stringify({checkedAt:new Date().toISOString(),endpoint,errors,failures,stopped,cinemaPosition,seatPosition,seatId:seat.id,seatedAvatar,exitPosition,cinemaActionLayouts,checks:['menu notice and original image','portrait/landscape scrolling and full-image dialog','Escape and restored focus','actual onboarding and square walk','shared/server board collision','nearby reading action','real walk up cinema ramp and picture house district','cinema panel nearby action','server-authoritative cinema sit and stand','live avatar tier height and Sit animation','portrait and landscape cinema watch and seat actions visible without overlap',...(endpoint.startsWith('http://localhost')?['physical board click']:[])]},null,2));
 console.log('PASS: welcome news, supplied meme, responsive viewer, square memories board, movement collision, picture house traversal and authoritative cinema seating');
}catch(error){for(const context of browser.contexts())for(const page of context.pages())await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}finally{await browser.close();}
