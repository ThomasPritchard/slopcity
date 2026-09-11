import test from 'node:test';
import assert from 'node:assert/strict';
import { CINEMA_LAYOUT, CINEMA_BENCHES, CINEMA_WALLS, cinemaFloorHeight } from '../shared/cinemaLayout.ts';
import { district, isWalkable, move } from '../shared/world.ts';
import { SEATS } from '../shared/social.ts';
import { floorHeight } from '../shared/casinoLayout.ts';
import { requestSit, requestStand } from '../server/seating.ts';

test('cinema arrival ramp reaches every terrace without crossing the screen or planters',()=>{
  let p={x:-11.8,z:-2};
  for(let i=0;i<270;i++)p=move(p,{x:-1,z:0},.01);
  assert.ok(p.x < -22.8 && p.x > -24.3);
  assert.equal(floorHeight(p.x,p.z),.06);
  assert.equal(district(p.x,p.z),'The Bridge Picture House');
  assert.equal(cinemaFloorHeight(-13.35,-2),.15);
  for(const tier of CINEMA_LAYOUT.tiers)assert.equal(floorHeight(tier.benchX,-2),tier.height);
  for(const wall of CINEMA_WALLS)assert.equal(isWalkable(wall.x,wall.z),false);
  for(let i=0;i<180;i++)p=move(p,{x:1,z:0},.02);
  assert.ok(p.x>-12 && floorHeight(p.x,p.z)===0);
});
test('all eighteen cinema seats are authoritative, face the screen and have clear exits on their own terrace',()=>{
  const seats=SEATS.filter(seat=>seat.id.startsWith('cinema-'));
  assert.equal(seats.length,18);assert.equal(CINEMA_BENCHES.length,9);
  for(const seat of seats){
    assert.ok(isWalkable(seat.x,seat.z));assert.ok(isWalkable(seat.exit.x,seat.exit.z));
    assert.equal(floorHeight(seat.x,seat.z),floorHeight(seat.exit.x,seat.exit.z));
    assert.ok(Math.sin(seat.heading)<-.98);
    const seated=requestSit({...seat.exit,seatId:'',heading:0},seat.id,[]);
    assert.ok(seated);assert.equal(requestSit({...seat.exit,seatId:'',heading:0},seat.id,[seated]),null);
    assert.deepEqual(requestStand(seated),{...seat.exit,seatId:'',heading:seat.heading});
  }
});
