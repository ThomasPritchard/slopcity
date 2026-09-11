import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const output='output/playwright/cinema-pointer';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const errors:string[]=[],results:unknown[]=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:3,hasTouch:true});page.setDefaultTimeout(90_000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://www.youtube.com/embed/**',r=>r.fulfill({contentType:'text/html',body:'<style>html,body,button{margin:0;width:100%;height:100%;background:#264238;color:white}</style><button onclick="parent.postMessage(\'cinema-fixture-click\',\'*\')">Native provider fixture</button>'}));
 await page.route('**/cinema-pointer-fixture.html',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}canvas{position:relative;z-index:1}</style><canvas tabindex="0"></canvas><script type="module">
 import {TownScene} from '/src/world/scene.ts';
 import {CreateBox} from '/node_modules/@babylonjs/core/Meshes/Builders/boxBuilder.js';
 const w=window.world=new TownScene(document.querySelector('canvas'));await w.ready;w.enter('local');w.dayCycle.setPreviewPhase(.25);
 w.camera.setTarget(new w.camera.target.constructor(-22,3.7,-2));w.camera.alpha=0;w.camera.beta=1.43;w.camera.radius=13;
 w.syncCommunity({revision:1,epochMs:Date.now(),serverNowMs:Date.now(),mode:'live',platform:'youtube',twitchChannel:'',youtubeVideoId:'abcdefghijk',schedule:[],images:[]});w.setCinemaPlaybackEnabled(true);
 window.nativeClicks=0;addEventListener('message',e=>{if(e.data==='cinema-fixture-click')window.nativeClicks++;});
 window.createBlocker=()=>{const b=CreateBox('pointer-regression-blocker',{size:2},w.scene),screen=w.scene.getMeshByName('cinema-screen');b.position.copyFrom(w.camera.globalPosition.add(screen.position).scale(.5));return b;};
 window.ready=true;</script>`}));
 await page.goto('http://localhost:5173/cinema-pointer-fixture.html');
 await page.waitForFunction(()=>(window as any).ready&&(window as any).world.cinemaPlayer.status.mounted);
 for(const [label,width,height,quality] of [['desktop',1280,800,'high'],['portrait',390,844,'high'],['landscape',844,390,'high'],['portrait-low',390,844,'low'],['landscape-ultra',844,390,'ultra']] as const){
  await page.setViewportSize({width,height});await page.evaluate(quality=>(window as any).world.setQuality(quality),quality);await page.waitForTimeout(300);
  const result=await page.evaluate(()=>{
   const w=(window as any).world,c=w.cinemaPlayer,canvas=document.querySelector('canvas')!;
   const original=w.scene.pick.bind(w.scene);let picks=0;w.scene.pick=(...args:unknown[])=>{picks++;return original(...args);};
   try{
    c.releasePointer();c.pointer={x:2,y:2};c.routePointer();const outsidePicks=picks;
    const corners=c.status.corners,center={x:corners.reduce((n:number,p:any)=>n+p.x,0)/4,y:corners.reduce((n:number,p:any)=>n+p.y,0)/4};
    c.pointer=center;c.routePointer();const visible=c.usesNativeControls,insidePicks=picks;c.routePointer();const repeatedPicks=picks;
    const blocker=(window as any).createBlocker();w.scene.render();c.update();const occluded=!c.usesNativeControls;
    blocker.position.y+=100;w.scene.render();c.update();const restored=c.usesNativeControls;blocker.dispose();
    c.releasePointer();c.pointerDragging=true;c.pointer=center;c.routePointer();const dragRetained=canvas.style.pointerEvents!== 'none';c.pointerDragging=false;c.routePointer();
    return{center,outsidePicks,insidePicks,repeatedPicks,visible,occluded,restored,dragRetained};
   }finally{w.scene.pick=original;}
  });
  assert.equal(result.outsidePicks,0,label);assert.equal(result.insidePicks,1,label);assert.equal(result.repeatedPicks,1,label);
  assert.ok(result.visible&&result.occluded&&result.restored&&result.dragRetained,JSON.stringify({label,...result}));
  const clicks=await page.evaluate(()=>(window as any).nativeClicks);
  await page.mouse.click(result.center.x,result.center.y);
  await page.waitForFunction(n=>(window as any).nativeClicks>n,clicks);
  await page.evaluate(()=>(window as any).world.cinemaPlayer.releasePointer());
  await page.touchscreen.tap(result.center.x,result.center.y);
  await page.waitForFunction(n=>(window as any).nativeClicks>n+1,clicks,{timeout:3000});
  await page.screenshot({path:`${output}/${label}.png`});results.push({label,quality,...result,nativeClick:true,firstTouch:true});
 }
 const retained=await page.evaluate(()=>{const w=(window as any).world,c=w.cinemaPlayer,frame=document.querySelector('iframe');w.camera.alpha=Math.PI;w.scene.render();c.update();const hidden=c.surface.style.visibility==='hidden';w.camera.alpha=0;w.scene.render();c.update();return{hidden,sameIframe:frame===document.querySelector('iframe'),mounted:c.status.mounted};});
 assert.ok(retained.hidden&&retained.sameIframe&&retained.mounted);assert.deepEqual(errors,[]);
 await writeFile(`${output}/results.json`,JSON.stringify({results,retained,errors,scope:'Headless actual TownScene and Babylon picking; static provider fixture, no live decode or physical phone performance claim.'},null,2));
 console.log(JSON.stringify({results,retained,errors}));
}finally{await browser.close();}
