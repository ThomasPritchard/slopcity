import { webkit } from 'playwright';
import { mkdir, writeFile, rm } from 'node:fs/promises';
const moving = process.env.CROWD_MOVING === '1';
const label = moving ? 'polished-moving' : 'polished';
await mkdir('output/playwright/polish', {recursive:true});
const fixture = `output/playwright/crowd-${label}.html`;
await writeFile(fixture, `<!doctype html><style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas><script type="module">import {TownScene} from '/src/world/scene.ts';const world=new TownScene(document.querySelector('canvas'));window.world=world;await world.ready;world.enter('local');window.ready=true;</script>`);
const browser=await webkit.launch({headless:true});
const page=await browser.newPage({viewport:{width:960,height:720}});
page.setDefaultTimeout(120000);
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const results=[];
try {
 await page.goto(`http://localhost:5173/${fixture}`);await page.waitForFunction(()=>!!(window as any).ready);
 for(const low of [false,true]) for(const count of (moving ? [64] : [1,16,32,64])) {
  await page.evaluate(({count,low,moving})=>{
   const w=(window as any).world;clearInterval((window as any).crowdMotionTimer);w.setQuality(low);const players=new Map();
   for(let i=0;i<count;i++)players.set(i===0?'local':`crowd-${i}`,{profileId:`crowd-${i}`,name:`Neighbour ${i}`,x:i===0?0:(i%8-3.5)*1.5,z:i===0?-12:-7+Math.floor(i/8)*1.4,heading:Math.PI,moving:moving&&i!==0,seatId:'',wave:0,skin:i%5,shirt:i%6,top:'starter-utility',bottoms:'starter-chinos',shoes:'starter-sneakers'});
   w.sync(players);w.recenter();w.camera.radius=13;w.camera.beta=1.05;
   if(moving)(window as any).crowdMotionTimer=setInterval(()=>{const t=performance.now()/1000;for(let i=1;i<count;i++){const p=players.get(`crowd-${i}`);p.x=(i%8-3.5)*1.5+Math.sin(t+i)*.2;p.heading=Math.cos(t+i)>0?Math.PI/2:-Math.PI/2;}w.sync(players);},50);
  },{count,low,moving});
  await page.waitForTimeout(1800);
  const sample=await page.evaluate(async()=>{
   const w=(window as any).world,s=w.scene,e=w.engine;const frames:number[]=[];let previous=performance.now();
   const observer=s.onAfterRenderObservable.add(()=>{const now=performance.now();frames.push(now-previous);previous=now;});
   await new Promise(resolve=>setTimeout(resolve,4000));s.onAfterRenderObservable.remove(observer);
   frames.sort((a,b)=>a-b);const mean=frames.reduce((a,b)=>a+b,0)/frames.length;
   return {frames:frames.length,fps:Math.round(10000/mean)/10,p95FrameMs:Math.round(frames[Math.floor(frames.length*.95)]??0),walkingGroups:s.animationGroups.filter((g:any)=>g.name.endsWith('/Walk')&&g.isPlaying).length,activeMeshes:s.getActiveMeshes().length,totalMeshes:s.meshes.length,activeIndices:s.getActiveIndices(),render:[e.getRenderWidth(),e.getRenderHeight()],waterRenderList:s.materials.find((m:any)=>m.name==='Living fountain water')?.getRenderList?.()?.length??null};
  });
  results.push({count,quality:low?'performance':'normal',...sample});console.log(JSON.stringify(results.at(-1)));
  if(count===64&&!low)await page.screenshot({path:`output/playwright/polish/crowd-${label}-64.png`});
 }
 await writeFile(`output/playwright/polish/crowd-${label}.json`,JSON.stringify({scope:'Headless WebKit, 960x720 DPR1, synthetic rendered avatars; not native device or network throughput',moving,results,errors},null,2));
 if(errors.length)throw Error(errors.join('\n'));
} finally {await browser.close();await rm(fixture,{force:true});}
