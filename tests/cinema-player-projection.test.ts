import test from 'node:test';
import assert from 'node:assert/strict';
import { cinemaHomography, cinemaPolygonsOverlap, type CinemaPoint } from '../src/world/cinemaPlayer.ts';

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
