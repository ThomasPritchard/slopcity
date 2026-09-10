import {webkit} from 'playwright';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('output/playwright/polish',{recursive:true});
const fixture='output/playwright/world-polish-fixture.html';
await writeFile(fixture,`<!doctype html><style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas><script type="module">import{TownScene}from'/src/world/scene.ts';const w=new TownScene(document.querySelector('canvas'));window.world=w;await w.ready;w.enter('local');window.ready=true;</script>`);
const browser=await webkit.launch({headless:true});const page=await browser.newPage({viewport:{width:1100,height:800}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(`${process.env.GAME_URL || 'http://localhost:5173'}/${fixture}`);await page.waitForFunction(()=>!!(window as any).ready);
 const immediate=await page.evaluate(()=>{
  const w=(window as any).world;const base={name:'Neighbour',profileId:'guest',heading:Math.PI,moving:false,seatId:'',wave:0,skin:0,shirt:0,top:'starter-utility',bottoms:'starter-chinos',shoes:'starter-sneakers'};
  const players=new Map([['local',{...base,x:0,z:-12}],['remote',{...base,x:0,z:2}]]);(window as any).players=players;w.sync(players);
  return w.scene.getTransformNodeByName('remote').position.asArray();
 });assert.deepEqual(immediate,[0,0,2],'new remote appears at first snapshot, never origin');
 await page.waitForTimeout(900);
 const modelState=()=>page.evaluate(()=>{const w=(window as any).world,root=w.scene.getTransformNodeByName('remote');return {vertices:root.getChildMeshes().reduce((n:number,m:any)=>n+m.getTotalVertices(),0),groups:w.scene.animationGroups.filter((g:any)=>g.name.startsWith('remote/')&&g.isPlaying).map((g:any)=>g.name),rootCount:w.scene.transformNodes.filter((n:any)=>n.name==='remote').length};});
 const far=await modelState();
 await page.evaluate(()=>{const w=(window as any).world,p=(window as any).players;p.get('remote').z=-8;w.sync(p);});await page.waitForTimeout(1000);const near=await modelState();assert.ok(near.vertices>far.vertices*2);assert.equal(near.rootCount,1);assert.ok(near.groups.some((name:string)=>name.endsWith('/Idle')));
 await page.evaluate(()=>{const w=(window as any).world,p=(window as any).players;p.get('remote').seatId='fixture-seat';w.sync(p);});await page.waitForTimeout(350);assert.deepEqual((await modelState()).groups,['remote/Sit']);
 await page.evaluate(()=>{const w=(window as any).world,p=(window as any).players;p.get('remote').seatId='';p.get('remote').wave=1;w.sync(p);});await page.waitForTimeout(500);assert.ok((await modelState()).groups.includes('remote/Wave'));
 // Non-default orbit and requested zoom survive both kinds of view change.
 await page.evaluate(()=>{const w=(window as any).world;w.camera.alpha=-1.1;w.camera.beta=1.2;w.camera.radius=9;});await page.waitForTimeout(300);
 await page.evaluate(()=>{const w=(window as any).world;w.customise((window as any).players.get('local'),false,true);});await page.waitForTimeout(300);await page.evaluate(()=>(window as any).world.enter('local'));await page.waitForTimeout(400);
 const view=()=>page.evaluate(()=>{const w=(window as any).world,c=w.camera;return{alpha:c.alpha,beta:c.beta,radius:c.radius,water:w.scene.materials.find((m:any)=>m.name==='Living fountain water').reflectionTexture.refreshRate};});
 const wardrobe=await view();assert.ok(Math.abs(wardrobe.alpha+1.1)<.01&&Math.abs(wardrobe.radius-9)<.05);
 await page.evaluate(()=>{const w=(window as any).world;w.setQuality(true);w.focusCasino({id:'blackjack-1',game:'blackjack',x:3,z:19,name:'Blackjack'});});await page.waitForTimeout(400);assert.equal((await view()).water,0);
 await page.evaluate(()=>(window as any).world.focusCasino(null));await page.waitForTimeout(500);const casino=await view();assert.ok(Math.abs(casino.alpha+1.1)<.01&&Math.abs(casino.radius-9)<.05);assert.equal(casino.water,3);
 await page.evaluate(()=>{const w=(window as any).world;w.setReducedMotion(true);w.syncCasino({serverTime:Date.now(),tables:[{id:'roulette-1',game:'roulette',roundId:'r',phase:'spinning',deadline:Date.now()+5000,result:null,betCount:1,history:[]}]});});
 const wheel=()=>page.evaluate(()=>{const w=(window as any).world;return{angle:w.scene.transformNodes.find((n:any)=>n.name==='roulette-wheel-instance').rotation.y,spray:Number(w.scene.getMeshByName('Fountain spray').isEnabled())};});
 await page.waitForTimeout(100);const still=await wheel();await page.waitForTimeout(250);assert.deepEqual(await wheel(),still);assert.equal(still.spray,0);
 await page.evaluate(()=>{const w=(window as any).world;w.setReducedMotion(false);});await page.waitForTimeout(250);assert.notEqual((await wheel()).angle,still.angle);
 const materialsBefore=await page.evaluate(()=>(window as any).world.scene.materials.length);
 for(let i=0;i<4;i++){
  await page.evaluate(()=>{const w=(window as any).world,p=(window as any).players;p.get('remote').z=2;w.sync(p);});await page.waitForTimeout(500);
  await page.evaluate(()=>{const w=(window as any).world,p=(window as any).players;p.get('remote').z=-8;w.sync(p);});await page.waitForTimeout(500);
 }
 assert.equal(await page.evaluate(()=>(window as any).world.scene.materials.length),materialsBefore,'repeated LOD switches dispose cloned materials');
 await page.evaluate(()=>{const w=(window as any).world,p=(window as any).players;p.get('remote').z=2;p.get('remote').wave=2;w.sync(p);});
 await page.waitForTimeout(3500);
 await page.evaluate(()=>{const w=(window as any).world,p=(window as any).players;p.get('remote').wave=3;w.sync(p);});
 await page.waitForFunction(()=>(window as any).world.scene.animationGroups.some((g:any)=>g.name==='remote/Wave'&&g.isPlaying));
 await page.waitForTimeout(3500);
 const settled=await page.evaluate(()=>{const w=(window as any).world;return w.scene.animationGroups.filter((g:any)=>g.name.startsWith('remote/')).map((g:any)=>({name:g.name,started:g.isStarted,playing:g.isPlaying}));});
 assert.ok(settled.find((g:{name:string;started:boolean;playing:boolean})=>g.name==='remote/Idle'&&g.started&&!g.playing),'distant wave completes into paused Idle');
 await page.screenshot({path:'output/playwright/polish/world-animation-check.png'});
 assert.deepEqual(errors,[]);await writeFile('output/playwright/polish/world-results.json',JSON.stringify({scope:'Actual renderer with synthetic player/game snapshots; network walkthrough is separate',far,near,wardrobe,casino,reducedMotion:still,distantWave: settled,errors},null,2));console.log('PASS: first-snapshot placement, near/far rigged LOD without duplicate roots, Sit/Wave transitions, saved non-default camera view, water quality restoration, repeated distant waves settle into idle, reduced motion stops/resumes wheel and spray.');
}finally{await browser.close();await rm(fixture,{force:true});}
