import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const endpoint=process.env.GAME_URL||'http://localhost:5173';
const output='output/playwright/fountain';await mkdir(output,{recursive:true});
const bytes=await readFile('public/models/fountain.glb');
assert.equal(bytes.toString('utf8',0,4),'glTF');
const gltf=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
const triangles=gltf.meshes.reduce((n:number,m:any)=>n+m.primitives.reduce((sum:number,p:any)=>sum+gltf.accessors[p.indices].count/3,0),0);
assert.ok(triangles<22_000&&bytes.length<800_000,'bounded civic prop budget');
assert.ok(gltf.meshes.length<=12);
const browser=await chromium.launch({headless:true}),errors:string[]=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
 const fixture=`${endpoint}/fountain-fixture.html`;
 await page.route(fixture,r=>r.fulfill({contentType:'text/html',body:`
  <style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas>
  <script type="module">import{TownScene}from'/src/world/scene.ts';window.world=new TownScene(document.querySelector('canvas'));await world.ready;world.dayCycle.setPreviewPhase(.25);window.ready=true;</script>`}));
 await page.goto(fixture);await page.waitForFunction(()=>(window as any).ready&&(window as any).world.scene.isReady());
 const asset=await page.evaluate(()=>{
  const w=(window as any).world,root=w.scene.getTransformNodeByName('fountain-instance');root.computeWorldMatrix(true);
  const bounds=root.getHierarchyBoundingVectors(),meshes=root.getChildMeshes().filter((m:any)=>m.getTotalVertices());
  return{position:root.position.asArray(),size:bounds.max.subtract(bounds.min).asArray(),copies:meshes.every((m:any)=>!m.sourceMesh),
   waterPosition:w.fountain.surface.position.asArray(),refraction:w.water.getRenderList().length,
   oldJets:w.scene.meshes.filter((m:any)=>m.name==='Water jet'||m.name==='Spray').length};
 });
 assert.deepEqual(asset.position,[0,0,1]);assert.deepEqual(asset.waterPosition,[0,.44,1]);assert.equal(asset.copies,true);
 assert.ok(Math.abs(asset.size[0]-6.5)<.01&&Math.abs(asset.size[2]-6.5)<.01&&asset.size[1]>3.3&&asset.size[1]<3.8);
 assert.equal(asset.oldJets,0);assert.ok(asset.refraction>=8,'mosaic and sculpture participate in pool rendering');
 const state=()=>page.evaluate(()=>{const w=(window as any).world,f=w.fountain;return{time:f.elapsed,spray:f.spray.isEnabled(),jets:f.streams.isEnabled(),reflection:w.water.reflectionTexture.refreshRate,normals:f.normals.refreshRate,meshes:w.scene.meshes.length,materials:w.scene.materials.length}});
 const normalPixels=()=>page.evaluate(async()=>Array.from(await (window as any).world.fountain.normals.readPixels()) as number[]);
 const difference=(a:number[],b:number[])=>a.reduce((n,v,i)=>n+(Math.abs(v-b[i])>1?1:0),0);
 const frames=[
  {name:'desktop',width:1440,height:1000,alpha:-1.15,beta:1.05,radius:10,low:false},
  {name:'pool-detail',width:1440,height:1000,alpha:-1.1,beta:.77,radius:7.7,low:false},
  {name:'sculpture-reverse',width:1440,height:1000,alpha:1.6,beta:1.08,radius:10,low:false},
  {name:'phone-portrait',width:390,height:844,alpha:-1.25,beta:1.1,radius:20,low:true},
  {name:'phone-landscape',width:844,height:390,alpha:-1.15,beta:1.05,radius:10,low:true},
 ];
 for(const frame of frames){
  await page.setViewportSize({width:frame.width,height:frame.height});
  await page.evaluate(frame=>{const w=(window as any).world;w.setQuality(frame.low);w.camera.setTarget(new w.camera.target.constructor(0,1.2,1));w.camera.alpha=frame.alpha;w.camera.beta=frame.beta;w.camera.radius=frame.radius},frame);
  await page.waitForFunction(()=>(window as any).world.scene.isReady());await page.waitForTimeout(750);
  await page.screenshot({path:`${output}/${frame.name}.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal((await state()).reflection,frame.low?3:1);
  assert.equal((await state()).spray,true);
 }
 // Check actual GPU texture updates; a clock advancing alone would not prove water motion.
 const movingBefore=await state(),normalBefore=await normalPixels();
 await page.waitForFunction(t=>(window as any).world.fountain.elapsed>t+.3,movingBefore.time);
 const normalAfter=await normalPixels();assert.ok(difference(normalBefore,normalAfter)>500,'visible moving ripple normals');
 await page.evaluate(()=>(window as any).world.setReducedMotion(true));await page.waitForTimeout(500);
 const stillBefore=await state(),stillPixels=await normalPixels();await page.waitForTimeout(500);
 assert.deepEqual(await state(),stillBefore,'reduced motion freezes the effect clock without rebuilding assets');
 assert.equal(stillBefore.spray,false);assert.equal(stillBefore.normals,0);
 assert.equal(difference(stillPixels,await normalPixels()),0,'reduced-motion water texture stays still');
 await page.screenshot({path:`${output}/reduced-motion.png`});
 await page.evaluate(()=>(window as any).world.setReducedMotion(false));
 await page.waitForFunction(t=>(window as any).world.fountain.elapsed>t,stillBefore.time);
 assert.equal((await state()).spray,true);
 // Existing focused-view policy pauses water effects and restores the selected quality.
 await page.evaluate(()=>(window as any).world.focusCasino({id:'blackjack-1',game:'blackjack',x:-8,z:30,name:'Blackjack'}));
 await page.waitForTimeout(300);assert.equal((await state()).reflection,0);assert.equal((await state()).spray,false);
 await page.evaluate(()=>(window as any).world.focusCasino(null));await page.waitForTimeout(500);
 assert.equal((await state()).reflection,3);assert.equal((await state()).spray,true);
 assert.equal((await state()).meshes,stillBefore.meshes);assert.equal((await state()).materials,stillBefore.materials);
 assert.deepEqual(errors,[]);
 await writeFile(`${output}/results.json`,JSON.stringify({checkedAt:new Date().toISOString(),browser:browser.version(),asset,triangles,bytes:bytes.length,movingNormalComponents:difference(normalBefore,normalAfter),errors,scope:'Actual TownScene, native GLB, desktop/emulated phone, normal/performance, GPU ripple motion and reduced motion, focused-view restoration. No physical phone or multiplayer capacity claim.'},null,2));
 console.log('PASS: fountain asset, pool/refraction setup, desktop/mobile rendering, animated GPU ripples, reduced motion and focus/quality restoration.');
}finally{await browser.close()}
