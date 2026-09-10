import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PLANTING_BEDS } from '../shared/world.ts';
import { DAY_CYCLE_MS } from '../src/world/dayCycleMath.ts';

const endpoint=process.env.GAME_URL||'http://localhost:5173',kind=process.env.BROWSER==='webkit'?'webkit':'chromium';
const output=`output/playwright/planting/${kind}`;await mkdir(output,{recursive:true});
const assets=[];
for(const name of ['tree','planter','entrance-planter']){
 const bytes=await readFile(`public/models/${name}.glb`);assert.equal(bytes.toString('utf8',0,4),'glTF');
 const gltf=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
 const triangles=gltf.meshes.reduce((n:number,m:any)=>n+m.primitives.reduce((n:number,p:any)=>n+gltf.accessors[p.indices].count/3,0),0);
 assert.ok(triangles<32_000&&bytes.length<1_400_000,`${name} bounded geometry/export`);
 for(const mesh of gltf.meshes)for(const p of mesh.primitives)if(/^(Tree leaves|Planting grass|Planting seed)/.test(gltf.materials[p.material].name))assert.ok('TEXCOORD_0'in p.attributes,'authored root-to-tip wind weights');
 assets.push({name,triangles,bytes:bytes.length,meshes:gltf.meshes.length});
}
const browser=await(kind==='webkit'?webkit:chromium).launch({headless:true}),errors:string[]=[];
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(30000);
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error(m.text().slice(0,450))}});
 page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
 const fixture=`${endpoint}/planting-check-fixture.html`;
 await page.route(fixture,r=>r.fulfill({contentType:'text/html',body:`<style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas><script type="module">import{TownScene}from'/src/world/scene.ts';window.w=new TownScene(document.querySelector('canvas'));await w.ready;w.dayCycle.setPreviewPhase(.25);w.setReducedMotion(true);window.ready=true;</script>`}));
 await page.goto(fixture);await page.waitForFunction(()=>(window as any).ready&&(window as any).w.scene.isReady());
 console.log('Planting renderer ready');
 const placement=await page.evaluate(()=>{
  const w=(window as any).w;
  return w.scene.transformNodes.filter((n:any)=>['planter-instance','entrance-planter-instance','tree-instance'].includes(n.name)).map((root:any)=>{
   root.computeWorldMatrix(true);const meshes=root.getChildMeshes().filter((m:any)=>m.getTotalVertices());
   const stone=meshes.filter((m:any)=>/Planting (warm limestone|honed coping)/.test(m.material.name));
   const bounds=stone.map((m:any)=>m.getBoundingInfo().boundingBox);
   const min=bounds.length?Math.min(...bounds.map((b:any)=>b.minimumWorld.x)):0,max=bounds.length?Math.max(...bounds.map((b:any)=>b.maximumWorld.x)):0;
   return{name:root.name,position:root.position.asArray(),copies:meshes.every((m:any)=>!m.sourceMesh),stoneWidth:max-min};
  });
 });
 assert.equal(placement.filter((p:{name:string;position:number[];copies:boolean;stoneWidth:number})=>p.name==='tree-instance').length,8);assert.equal(placement.length,16);
 for(const bed of PLANTING_BEDS){
  const placed=placement.find((p:{name:string;position:number[];copies:boolean;stoneWidth:number})=>p.name===`${bed.asset}-instance`&&p.position[0]===bed.x&&p.position[2]===bed.z)!;
  assert.ok(placed?.copies);assert.deepEqual(placed.position,[bed.x,0,bed.z]);assert.ok(Math.abs(placed.stoneWidth-bed.w)<.01);
  const tree=placement.find((p:{name:string;position:number[];copies:boolean;stoneWidth:number})=>p.name==='tree-instance'&&p.position[0]===bed.x&&p.position[2]===bed.z)!;
  assert.ok(tree?.copies);assert.equal(tree.position[1],.52);
 }
 const cameraBeds=await page.evaluate(()=>{const w=(window as any).w;return w.walls.filter((m:any)=>m.name==='planter').map((m:any)=>{const ray=w.camera.getForwardRay(5);ray.origin.set(m.position.x,3,m.position.z);ray.direction.set(0,-1,0);return w.scene.pickWithRay(ray,(mesh:any)=>w.walls.includes(mesh))?.distance})});
 assert.equal(cameraBeds.length,8);assert.ok(cameraBeds.every((d:number)=>Math.abs(d-2.4)<.001),'camera avoids all eight stone beds');
 const aim=async(x:number,y:number,z:number,radius:number,alpha=-1.15,beta=1.1)=>{
  await page.evaluate(({x,y,z,radius,alpha,beta})=>{const w=(window as any).w;w.camera.setTarget(new w.camera.target.constructor(x,y,z));w.camera.alpha=alpha;w.camera.beta=beta;w.camera.radius=radius},{x,y,z,radius,alpha,beta});
  await page.waitForFunction(()=>(window as any).w.scene.isReady());await page.waitForTimeout(350);
 };
 const beforePixels=()=>page.evaluate(async()=>{const w=(window as any).w;(window as any).pixels=await w.engine.readPixels(0,0,w.engine.getRenderWidth(),w.engine.getRenderHeight())});
 const changedPixels=()=>page.evaluate(async()=>{const w=(window as any).w,a=(window as any).pixels,b=await w.engine.readPixels(0,0,w.engine.getRenderWidth(),w.engine.getRenderHeight());let changed=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>8)changed++;return changed});
 const visibility=[];
 for(const low of [false,true]){
  await page.evaluate(low=>(window as any).w.setQuality(low),low);
  assert.equal(await page.evaluate(()=>(window as any).w.shadows.mapSize),low?1024:2048);
  for(const bed of PLANTING_BEDS){
   await aim(bed.x,.8,bed.z,6.5);
   await page.evaluate(bed=>{const w=(window as any).w,root=w.scene.transformNodes.find((r:any)=>r.name===`${bed.asset}-instance`&&r.position.x===bed.x&&r.position.z===bed.z);(window as any).coping=root.getChildMeshes().find((m:any)=>m.material?.name==='Planting honed coping')},bed);
   await beforePixels();await page.evaluate(()=>(window as any).coping.setEnabled(false));await page.waitForTimeout(150);
   const pixels=await changedPixels();assert.ok(pixels>80,`visible stone coping at ${bed.x},${bed.z}, performance=${low}: ${pixels}`);
   await page.evaluate(()=>(window as any).coping.setEnabled(true));visibility.push({x:bed.x,z:bed.z,low,pixels});console.log(`Bed ${bed.x},${bed.z} low=${low}: ${pixels} coping pixels`);
  }
 }
 await page.evaluate(()=>{const w=(window as any).w;w.setQuality(false);w.vegetation.setReducedMotion(false)});
 await aim(-10,.82,-11,3.4,-1.35,.88);
 await beforePixels();const windStart=await page.evaluate(()=>(window as any).w.vegetation.elapsed);
 await page.waitForFunction(time=>(window as any).w.vegetation.elapsed>time+.7,windStart);
 const windPixels=await changedPixels();assert.ok(windPixels>500,`actual moving grass pixels: ${windPixels}`);
 await page.screenshot({path:`${output}/grass-detail.png`});
 await page.evaluate(()=>(window as any).w.setReducedMotion(true));await page.waitForTimeout(350);await beforePixels();
 const frozen=await page.evaluate(()=>(window as any).w.vegetation.elapsed);await page.waitForTimeout(400);
 assert.equal(await page.evaluate(()=>(window as any).w.vegetation.elapsed),frozen);
 assert.equal(await changedPixels(),0,'reduced motion freezes rendered vegetation, with water and daylight fixed');
 // All lights, sky and reflected environment are driven from one deterministic phase.
 const cycle=[];
 await aim(0,2,-3,29,-1.35,1.1);
 for(const[name,phase]of [['noon',.25],['sunset',.49],['night',.75],['dawn',.01]]as const){
  await page.evaluate(phase=>(window as any).w.dayCycle.setPreviewPhase(phase),phase);await page.waitForTimeout(400);
  const state=await page.evaluate(()=>{const w=(window as any).w;return{...w.dayCycle.state,lights:w.lampLighting.lights.map((l:any)=>l.intensity),environment:w.scene.environmentIntensity}});
  if(name==='noon')assert.ok(state.lights.every((n:number)=>n===0));if(name==='night')assert.ok(state.lights.every((n:number)=>Math.abs(n-.65)<.001));
  cycle.push({name,...state});await page.screenshot({path:`${output}/${name}.png`});
 }
 // Rejoining and OS clock skew are handled by the existing server UTC messages.
 await page.evaluate(serverTime=>{const w=(window as any).w;w.dayCycle.setPreviewPhase(null);w.syncCasino({serverTime,tables:[]})},DAY_CYCLE_MS*.75);
 await page.waitForTimeout(200);assert.ok(Math.abs(await page.evaluate(()=>(window as any).w.dayCycle.state.phase)-.75)<.002);
 const profile={name:'Inspection',profileId:'fixture',heading:0,moving:false,seatId:'',wave:0,skin:0,shirt:0,top:'starter-utility',bottoms:'starter-chinos',shoes:'starter-sneakers',x:0,z:-17};
 await page.evaluate(profile=>{const w=(window as any).w;w.dayCycle.setPreviewPhase(.75);w.customise(profile)},profile);await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>(window as any).w.dayCycle.state.phase),.25,'changing-room lighting stays neutral at midnight');
 assert.equal(await page.evaluate(()=>(window as any).w.scene.environmentIntensity),.7);
 await page.screenshot({path:`${output}/neutral-changing-room.png`});
 await page.evaluate(()=>{const w=(window as any).w;w.enter('inspection');w.dayCycle.setPreviewPhase(.25);w.camera.upperRadiusLimit=50});
 await aim(-10,2.3,-11,9);await page.screenshot({path:`${output}/tree-and-bed.png`});
 await aim(-19.5,1.8,-20,15,-1.55,1.02);await page.screenshot({path:`${output}/entrance-west.png`});
 await aim(20,1.8,-20,15,-1.55,1.02);await page.screenshot({path:`${output}/entrance-east.png`});
 for(const[name,width,height,radius]of [['phone-portrait',390,844,13],['phone-landscape',844,390,9]]as const){
  await page.setViewportSize({width,height});await page.evaluate(()=>(window as any).w.setQuality(true));await aim(-10,2.2,-11,radius);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await page.evaluate(()=>(window as any).w.vegetation.meshes.filter((m:any)=>m.material.name==='Planting grass detail').some((m:any)=>m.isEnabled())),false);
  await page.screenshot({path:`${output}/${name}.png`});
 }
 await page.evaluate(()=>(window as any).w.setQuality(false));
 assert.equal(await page.evaluate(()=>(window as any).w.vegetation.meshes.filter((m:any)=>m.material.name==='Planting grass detail').every((m:any)=>m.isEnabled())),true);
 assert.deepEqual(errors,[]);
 await writeFile(`${output}/results.json`,JSON.stringify({checkedAt:new Date().toISOString(),browser:browser.version(),assets,placement,visibility,windPixels,cycle,errors,scope:'Actual GLB/TownScene framebuffer checks for every stone bed in normal/performance, moving grass and frozen reduced motion, deterministic cycle, server-time alignment, neutral changing-room, desktop/emulated phone. Physical device and multiplayer performance unmeasured.'},null,2));
 console.log(`PASS ${kind}: all eight planting beds render, grass moves and freezes correctly, 30-minute day/night and lamps, server clock, neutral changing-room and desktop/mobile.`);
}finally{await browser.close()}
