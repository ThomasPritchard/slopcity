import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldCinemaPlayer, cinemaContainsPoint, cinemaHomography, cinemaPolygonsOverlap, type CinemaPoint } from '../src/world/cinemaPlayer.ts';

function transform(matrix:number[],x:number,y:number){const w=matrix[3]*x+matrix[7]*y+matrix[15];return{x:(matrix[0]*x+matrix[4]*y+matrix[12])/w,y:(matrix[1]*x+matrix[5]*y+matrix[13])/w};}
const rectangle=(x:number,y:number,w:number,h:number):CinemaPoint[]=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];

test('screen homography preserves all four corners including CSS offsets and oblique perspective',()=>{
 for(const quad of[rectangle(153,228,1133,564),[{x:395,y:329},{x:1202,y:127},{x:1293,y:761},{x:357,y:755}]]){
  const matrix=cinemaHomography(quad);
  for(const[index,[x,y]]of[[0,0],[960,0],[960,540],[0,540]].entries()){
   const actual=transform(matrix,x,y);assert.ok(Math.abs(actual.x-quad[index].x)<1e-8);assert.ok(Math.abs(actual.y-quad[index].y)<1e-8);
  }
 }
});

test('polygon occlusion catches contained and crossing narrow blockers that corner rays miss',()=>{
 const screen=rectangle(100,100,800,450);
 assert.equal(cinemaPolygonsOverlap(screen,rectangle(400,200,40,200)),true);
 assert.equal(cinemaPolygonsOverlap(screen,rectangle(90,320,820,3)),true);
 assert.equal(cinemaPolygonsOverlap(screen,rectangle(900,200,30,20)),true,'Edge contact is conservative');
 assert.equal(cinemaPolygonsOverlap(screen,rectangle(901,200,30,20)),false);
});

test('polygon occlusion rejects empty space inside an oblique screen bounding rectangle',()=>{
 const screen=[{x:300,y:200},{x:900,y:70},{x:1000,y:700},{x:270,y:680}];
 assert.equal(cinemaPolygonsOverlap(screen,rectangle(300,75,60,50)),false);
 assert.equal(cinemaPolygonsOverlap(screen,rectangle(500,300,60,50)),true);
 assert.equal(cinemaPolygonsOverlap(screen,[]),false);
});

test('pointer containment follows the projected quadrilateral including edges and reverse winding',()=>{
 const screen=[{x:300,y:200},{x:900,y:70},{x:1000,y:700},{x:270,y:680}];
 for(const corners of[screen,[...screen].reverse()]){
  assert.equal(cinemaContainsPoint(corners,{x:500,y:300}),true);
  assert.equal(cinemaContainsPoint(corners,{x:310,y:90}),false,'Inside bounding rectangle but outside video');
  assert.equal(cinemaContainsPoint(corners,screen[0]),true,'Include screen corner');
  assert.equal(cinemaContainsPoint(corners,{x:600,y:135}),true,'Include screen edge');
 }
 assert.equal(cinemaContainsPoint([], {x:0,y:0}),false);
 assert.equal(cinemaContainsPoint(rectangle(0,0,0,0), {x:0,y:0}),false);
 assert.equal(cinemaContainsPoint(screen, {x:NaN,y:0}),false);
});

test('actual pointer router skips outside video, preserves occlusion and deduplicates only within a frame',t=>{
 // Exercise the production router with a deterministic scene/DOM boundary.
 // Browser coverage also verifies the real Babylon pick and native iframe input.
 const canvas={style:{pointerEvents:''},getBoundingClientRect:()=>({left:25,top:40})};
 const portalMaterial={},screenMesh={material:portalMaterial},blocker={};
 let frame=1,picks=0,domReads=0,hit:object=screenMesh,foreground:object=canvas;
 const player=Object.assign(Object.create(WorldCinemaPlayer.prototype),{
  canvas,portalMaterial,screenMesh,camera:{},pointerDragging:false,pointerPick:null,
  pointer:{x:310,y:90},state:{corners:[{x:300,y:200},{x:900,y:70},{x:1000,y:700},{x:270,y:680}]},
  surface:{style:{visibility:'visible'},contains:()=>false},root:{},
  scene:{getFrameId:()=>frame,pick:(x:number,y:number)=>{picks++;assert.equal(x,475);assert.equal(y,260);return{pickedMesh:hit};}},
 }) as {pointer:CinemaPoint;pointerDragging:boolean;routePointer:()=>void};
 const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{elementFromPoint:()=>{domReads++;return foreground;}}});
 t.after(()=>{if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else Reflect.deleteProperty(globalThis,'document');});
 player.routePointer();
 assert.equal(picks,0);assert.equal(domReads,0,'Outside quad skips DOM hit testing too');
 player.pointer={x:500,y:300};player.routePointer();
 assert.equal(picks,1);assert.equal(canvas.style.pointerEvents,'none','Visible video receives native controls');
 player.routePointer();assert.equal(picks,1,'Repeated routing of the same ray in one frame reuses the pick');
 foreground={};player.routePointer();
 assert.equal(canvas.style.pointerEvents,'','Foreground UI still blocks routing within a cached frame');
 foreground=canvas;hit=blocker;frame++;player.routePointer();
 assert.equal(picks,2);assert.equal(canvas.style.pointerEvents,'','Moving occluder blocks controls on the next frame');
 hit=screenMesh;frame++;player.routePointer();
 assert.equal(picks,3);assert.equal(canvas.style.pointerEvents,'none','Moving occluder leaving restores controls');
 player.pointer={x:310,y:90};player.routePointer();
 assert.equal(picks,3);assert.equal(canvas.style.pointerEvents,'','Leaving the video restores world input');
 player.pointerDragging=true;player.pointer={x:500,y:300};frame++;player.routePointer();
 assert.equal(picks,3);assert.equal(canvas.style.pointerEvents,'','World drag stays with the canvas over the video');
});
