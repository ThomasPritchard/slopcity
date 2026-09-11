import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { CINEMA_LAYOUT } from '../shared/cinemaLayout.ts';
const endpoint=process.env.GAME_URL||'http://localhost:5173';
const output='output/playwright/cinema-render';await mkdir(output,{recursive:true});
const fixture=`${output}/fixture.html`;
await writeFile(fixture,`<!doctype html><style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas><script type="module">
import {TownScene} from '/src/world/scene.ts';
const w=window.world=new TownScene(document.querySelector('canvas'));await w.ready;
w.syncCommunity(await(await fetch('/game/api/community/programme')).json());w.setReducedMotion(true);
w.camera.upperBetaLimit=1.55;w.dayCycle.setPreviewPhase(.25);window.ready=true;
</script>`);
const bytes=await readFile('public/models/cinema.glb');assert.equal(bytes.toString('utf8',0,4),'glTF');
const gltf=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
const triangles=gltf.meshes.reduce((n:number,m:any)=>n+m.primitives.reduce((n:number,p:any)=>n+gltf.accessors[p.indices].count/3,0),0);
assert.ok(triangles<80_000&&bytes.length<5_000_000,'Bounded original cinema asset');
const browser=await chromium.launch({headless:true});const errors:string[]=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(90_000);
 page.on('pageerror',error=>errors.push(error.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${new URL(r.url()).pathname}`);});
 await page.goto(`${endpoint}/${fixture}`);await page.waitForFunction(()=>(window as any).ready&&(window as any).world.scene.isReady());
 const imported=await page.evaluate(()=>{
  const w=(window as any).world,root=w.scene.getTransformNodeByName('cinema-instance');root.computeWorldMatrix(true);
  for(const mesh of root.getChildMeshes())mesh.computeWorldMatrix(true);
  const bounds=root.getHierarchyBoundingVectors();
  return {min:bounds.min.asArray(),max:bounds.max.asArray(),screen:w.scene.getMeshByName('cinema-screen').position.asArray(),benches:w.scene.transformNodes.filter((n:any)=>n.name==='bench-instance'&&n.position.x<-12).map((n:any)=>n.position.asArray())};
 });
 assert.ok(imported.max[0]<-12&&imported.min[0]>-27,'Handedness conversion keeps the cinema on the west edge');
 assert.equal(imported.benches.length,9);assert.deepEqual(imported.screen,[CINEMA_LAYOUT.screen.x,CINEMA_LAYOUT.screen.y,CINEMA_LAYOUT.screen.z]);
 for(const tier of CINEMA_LAYOUT.tiers)assert.equal(imported.benches.filter((p:number[])=>p[0]===tier.benchX&&p[1]===tier.height).length,3);
 for(const frame of [
  {name:'arrival-day',target:[-20.5,2.8,-2],alpha:-.5,beta:1.22,radius:21,phase:.25},
  {name:'overview-day',target:[-19.5,1.8,-2],alpha:-.35,beta:.64,radius:22,phase:.25},
  {name:'seated-day',target:[-24.49,3.8,-2],alpha:0,beta:1.53,radius:11,phase:.25},
  {name:'arrival-night',target:[-20.5,2.8,-2],alpha:-.5,beta:1.22,radius:21,phase:.75},
  {name:'seated-night',target:[-24.49,3.8,-2],alpha:0,beta:1.53,radius:11,phase:.75},
 ]){
  await page.evaluate(frame=>{const w=(window as any).world;w.camera.setTarget(w.camera.target.constructor.FromArray(frame.target));Object.assign(w.camera,{alpha:frame.alpha,beta:frame.beta,radius:frame.radius});w.dayCycle.setPreviewPhase(frame.phase);},frame);
  await page.waitForFunction(()=>(window as any).world.scene.isReady());await page.waitForTimeout(400);
  await page.screenshot({path:`${output}/${frame.name}.png`});
 }
 for(const [name,width,height] of [['portrait',390,844],['landscape',844,390]] as const){
  await page.setViewportSize({width,height});await page.evaluate(()=>{const w=(window as any).world;w.setQuality(true);w.dayCycle.setPreviewPhase(.25);w.camera.setTarget(new w.camera.target.constructor(-22,3,-2));w.camera.alpha=-.3;w.camera.beta=1.3;w.camera.radius=18;});
  await page.waitForFunction(()=>(window as any).world.scene.isReady());await page.waitForTimeout(250);await page.screenshot({path:`${output}/${name}.png`});
 }
 assert.deepEqual(errors,[]);await writeFile(`${output}/results.json`,JSON.stringify({endpoint,triangles,bytes:bytes.length,imported,errors,scope:'Headless actual renderer; no physical-device performance or provider video proof'},null,2));
 console.log('PASS cinema west placement, authored terraces, nine benches, actual day/night renderer and phone layouts');
}finally{await browser.close();}
