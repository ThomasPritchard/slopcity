import {webkit} from 'playwright';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
import type {CasinoState,BlackjackView,Card} from '../shared/casino';
await mkdir('output/playwright',{recursive:true});
const fixture='output/playwright/casino-render-fixture.html';
await writeFile(fixture,`<!doctype html><style>html,body,canvas{margin:0;width:100%;height:100%;display:block;overflow:hidden}</style><canvas></canvas><script type="module">import {TownScene} from '/src/world/scene.ts';const world=new TownScene(document.querySelector('canvas'));window.world=world;await world.ready;window.ready=true;</script>`);
const browser=await webkit.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const card=(rank:Card['rank'],suit:Card['suit']):Card=>({rank,suit});
const table:BlackjackView={id:'blackjack-1',game:'blackjack',roundId:'render-only-round',phase:'playing',deadline:Date.now()+30000,dealer:[card('9','hearts'),null],dealerTotal:null,activeSeat:2,activeHand:0,seats:[{seat:2,player:{profileId:'render-fixture',name:'Render fixture',connected:true},hands:[{cards:[card('8','clubs'),card('3','diamonds')],stake:10,total:11,soft:false,state:'playing',actions:['hit','stand','double']},{cards:[card('8','hearts'),card('K','spades')],stake:10,total:18,soft:false,state:'playing',actions:[]}]}]};
const state:CasinoState={serverTime:Date.now(),tables:[table]};
type RenderedCard={name:string;material:string;x:number;y:number;z:number};
const activeCards=():Promise<RenderedCard[]>=>page.evaluate(()=>(window as any).world.scene.meshes.filter((mesh:any)=>mesh.name.startsWith('casino-card-')&&mesh.isEnabled()).map((mesh:any)=>({name:mesh.name,material:mesh.material.name,x:mesh.position.x,y:mesh.position.y,z:mesh.position.z})));
try{
 await page.goto('http://localhost:5173/output/playwright/casino-render-fixture.html');await page.waitForFunction(()=>Boolean((window as any).ready));
 await page.evaluate(state=>{const world=(window as any).world;world.syncCasino(state);world.focusCasino({id:'blackjack-1',game:'blackjack',x:3,z:19,name:'Blackjack'});},state);
 await page.waitForTimeout(550);let cards=await activeCards();assert.equal(cards.length,6);assert.equal(cards.find(c=>c.name.endsWith('dealer-1'))?.material,'card-back');assert.ok(cards.every(c=>c.y>1.145&&c.y<1.2));
 const left=cards.find(c=>c.name.endsWith('-2-0-0'))!,right=cards.find(c=>c.name.endsWith('-2-1-0'))!;assert.ok(right.x-left.x>.4,'split hands separate on the felt');
 await page.screenshot({path:'output/playwright/casino-render-split-fixture.png'});
 table.seats[0].hands[0].cards.push(card('5','spades'));table.seats[0].hands[0].total=16;
 await page.evaluate(state=>(window as any).world.syncCasino(state),state);await page.waitForTimeout(550);cards=await activeCards();assert.equal(cards.length,7);assert.ok(cards.filter(c=>c.name.includes('-2-')).every(c=>Math.abs(c.z-18.088)<.02),'dealt cards arrive at hand positions');
 table.phase='result';table.dealer=[card('9','hearts'),card('K','diamonds')];table.dealerTotal=19;await page.evaluate(state=>(window as any).world.syncCasino(state),state);await page.waitForTimeout(400);assert.equal((await activeCards()).find(c=>c.name.endsWith('dealer-1'))?.material,'card-K-diamonds');
 table.dealer=[];table.seats=[];await page.evaluate(state=>(window as any).world.syncCasino(state),state);assert.equal((await activeCards()).length,0);assert.deepEqual(errors,[]);
 console.log('PASS: actual 3D renderer displays split hands, deals a hit to the felt, hides/reveals the dealer card, and clears the finished layout. Synthetic public state fixture; no wagering or network claim.');
}finally{await browser.close();await rm(fixture,{force:true});}
