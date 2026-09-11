import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { LAMP_POSTS } from '../src/world/lampPosts';
const endpoint=process.env.GAME_URL||'http://localhost:5173',output='output/playwright/lamps';
await mkdir(output,{recursive:true});
const bytes=await readFile('public/models/lamp.glb');assert.equal(bytes.toString('utf8',0,4),'glTF');
const gltf=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
const triangles=gltf.meshes.reduce((n:number,m:any)=>n+m.primitives.reduce((n:number,p:any)=>n+gltf.accessors[p.indices].count/3,0),0);
assert.ok(triangles<7500&&bytes.length<400_000);assert.equal(gltf.meshes.length,6);
assert.ok(gltf.nodes.some((n:any)=>n.name==='lamp-light-source'));
assert.equal(gltf.materials.find((m:any)=>m.name==='Lamp warm glass').alphaMode,'BLEND');
const browser=await chromium.launch({headless:true}),errors:string[]=[];
try{
 const page=await browser.newPage({viewport:{width:1200,height:1000}});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
 const fixture=`${endpoint}/lamp-posts-fixture.html`;
 await page.route(fixture,r=>r.fulfill({contentType:'text/html',body:`<style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas><script type="module">import{TownScene}from'/src/world/scene.ts';window.world=new TownScene(document.querySelector('canvas'));await world.ready;world.dayCycle.setPreviewPhase(.75);world.setReducedMotion(true);window.ready=true;</script>`}));
 await page.goto(fixture);await page.waitForFunction(()=>(window as any).ready&&(window as any).world.scene.isReady());
 const setup=await page.evaluate(()=>{
  const w=(window as any).world;
  return{lights:w.lampLighting.lights.map((l:any)=>({position:l.position.asArray(),range:l.range,warm:l.diffuse.r>l.diffuse.g&&l.diffuse.g>l.diffuse.b,interiorExcluded:l.excludedMeshes.some((m:any)=>m.name.startsWith('meridian-interior/'))})),
   posts:w.lampPosts.map((root:any)=>{root.computeWorldMatrix(true);const bounds=root.getHierarchyBoundingVectors();return{position:root.position.asArray(),height:bounds.max.y-bounds.min.y,copies:root.getChildMeshes().every((m:any)=>!m.sourceMesh)}}),
   groundBudget:Math.min(...w.scene.meshes.filter((m:any)=>m.name.startsWith('town-ground/')&&m.material).map((m:any)=>m.material.maxSimultaneousLights))};
 });
 assert.equal(setup.lights.length,4);assert.equal(setup.posts.length,4);assert.ok(setup.groundBudget>=6);
 for(let i=0;i<4;i++){
  const post=LAMP_POSTS[i],light=setup.lights[i];assert.deepEqual(setup.posts[i].position,[post.x,0,post.z]);
  assert.equal(light.position[0],post.x);assert.equal(light.position[2],post.z);assert.ok(Math.abs(light.position[1]-3.83)<.001);
  assert.ok(light.warm&&light.interiorExcluded&&setup.posts[i].copies);assert.ok(Math.abs(setup.posts[i].height-4.425)<.005);
 }
 // View the northwest post from inside the square so the fuller tree crown does not hide the paving.
 const aim=async(index:number,low=false)=>{
  await page.evaluate(({index,low})=>{const w=(window as any).world,p=w.lampLighting.lights[index].position;w.setQuality(low);w.camera.setTarget(new w.camera.target.constructor(p.x,1.8,p.z));w.camera.alpha=index===1?-1.0:-2.2;w.camera.beta=1.15;w.camera.radius=9;},{index,low});
  await page.waitForFunction(()=>(window as any).world.scene.isReady());await page.waitForTimeout(400);
 };
 // Select visible paving before comparing light states; trees can obscure projected positions.
 const groundPixels=async(index:number)=>page.evaluate(index=>{
  const w=(window as any).world,p=w.lampLighting.lights[index].position,V=w.camera.target.constructor,m=w.scene.getTransformMatrix();
  const width=w.engine.getRenderWidth(),height=w.engine.getRenderHeight();
  const viewport=w.camera.viewport.toGlobal(width,height),scale=w.engine.getHardwareScalingLevel();
  const pixels:number[][]=[];
  for(const x of [-1.7,-1.1,.7,1.3,1.9])for(const z of [-1.7,-1.1,.7,1.3,1.9]){
   const position=new V(p.x+x,.01,p.z+z),q=V.Project(position,m.constructor.Identity(),m,viewport);
   if(q.x<1||q.x>=width-1||q.y<1||q.y>=height-1)continue;
   const hit=w.scene.pick(q.x*scale,q.y*scale,(mesh:any)=>mesh.isEnabled()&&mesh.isVisible&&mesh.visibility>.01);
   if(hit?.pickedMesh?.name.startsWith('town-ground/')&&V.Distance(hit.pickedPoint,position)<.08)pixels.push([Math.round(q.x),height-Math.round(q.y)]);
  }
  return pixels;
 },index);
 const sample=async(pixels:number[][])=>page.evaluate(async pixels=>{
  const w=(window as any).world;
  return Promise.all(pixels.map(async([x,y])=>Array.from(await w.engine.readPixels(x,y,1,1)) as number[]));
 },pixels);
 const illumination=[];
 for(const low of [false,true])for(let index=0;index<4;index++){
  await aim(index,low);const pixels=await groundPixels(index);assert.ok(pixels.length>=3,`pole ${index+1}: visible paving samples`);const on=await sample(pixels);
  // Keep the other three lamps enabled: this catches material light-budget truncation.
  await page.evaluate(index=>(window as any).world.lampLighting.lights[index].setEnabled(false),index);
  await page.waitForTimeout(250);const off=await sample(pixels);
  await page.evaluate(index=>(window as any).world.lampLighting.lights[index].setEnabled(true),index);
  const delta=on.map((rgb,j)=>rgb.slice(0,3).reduce((n,v,k)=>n+v-off[j][k],0)/3);
  assert.ok(delta.filter(n=>n>3).length>=3,`pole ${index+1}, low=${low}: actual ground illumination ${JSON.stringify({on,off,delta})}`);
  illumination.push({index,low,pixels,delta});
 }
 // New citizen materials must also support all four posts after asynchronous cloning.
 await page.evaluate(()=>{const w=(window as any).world;w.sync(new Map([['lamp-visitor',{name:'Visitor',profileId:'fixture',heading:0,moving:false,seatId:'',wave:0,skin:0,shirt:0,top:'starter-utility',bottoms:'starter-chinos',shoes:'starter-sneakers',x:7.6,z:9.25}]]))});
 await page.waitForFunction(()=>{const w=(window as any).world;return w.scene.getTransformNodeByName('lamp-visitor').getChildMeshes().filter((m:any)=>m.material&&'maxSimultaneousLights'in m.material).every((m:any)=>m.material.maxSimultaneousLights>=6)});
 await page.evaluate(()=>(window as any).world.sync(new Map()));
 await page.evaluate(()=>(window as any).world.dayCycle.setPreviewPhase(.25));
 await page.setViewportSize({width:1200,height:1000});await aim(0);await page.screenshot({path:`${output}/daylight.png`});
 await page.evaluate(()=>{const w=(window as any).world;w.camera.setTarget(new w.camera.target.constructor(-6.5,3.86,-12));w.camera.radius=3;w.camera.beta=1.28});await page.waitForTimeout(400);await page.screenshot({path:`${output}/lantern-detail.png`});
 // Fixed night phase makes the lighting comparison reproducible.
 await aim(0);await page.evaluate(()=>(window as any).world.dayCycle.setPreviewPhase(.75));
 await page.waitForTimeout(500);await page.screenshot({path:`${output}/dusk-preview.png`});
 for(const[frame,width,height,radius]of[['phone-portrait',390,844,11],['phone-landscape',844,390,8]]as const){
  await page.setViewportSize({width,height});await page.evaluate(radius=>{const w=(window as any).world;w.setQuality(true);w.camera.radius=radius},radius);await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>(window as any).world.lampLighting.lights.every((l:any)=>l.isEnabled())),true);
  assert.equal(await page.evaluate(()=>(window as any).world.lampLighting.glow.isEnabled),false);
  await page.screenshot({path:`${output}/${frame}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 await page.evaluate(()=>(window as any).world.setQuality(false));assert.equal(await page.evaluate(()=>(window as any).world.lampLighting.glow.isEnabled),true);
 assert.deepEqual(errors,[]);
 await writeFile(`${output}/results.json`,JSON.stringify({checkedAt:new Date().toISOString(),browser:browser.version(),triangles,bytes:bytes.length,setup,illumination,errors,scope:'Actual lamp GLB and TownScene. Independent framebuffer proof for all four point lights, normal/performance, late-created citizen materials, desktop/emulated phone. Fixed cycle phases; physical device performance is unmeasured.'},null,2));
 console.log('PASS: lamp models, emitter alignment, all four point lights illuminate real pixels, late-created materials, normal/performance and desktop/mobile captures.');
}finally{await browser.close()}
