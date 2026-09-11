import test from 'node:test';
import assert from 'node:assert/strict';
import { expireCommunityProgramme } from '../src/community/useCommunity.ts';
import type { Programme } from '../shared/community.ts';

const programme: Programme = {revision:1,epochMs:0,serverNowMs:0,mode:'live',platform:'twitch',twitchChannel:'bridgemindai',youtubeVideoId:'',schedule:[],images:[{id:'memory',title:'A memory',credit:'',imageUrl:'/image',width:100,height:100,featured:false,sortOrder:0}]};
test('expired background programme keeps the playing source but clears moderated images',()=>{
 const expired=expireCommunityProgramme(programme,true)!;
 assert.equal(expired.mode,'live');assert.equal(expired.twitchChannel,programme.twitchChannel);
 assert.deepEqual(expired.images,[]);assert.equal(programme.images.length,1);
 assert.equal(expireCommunityProgramme(expired,true),expired,'Repeated stale clock ticks do not recreate the programme');
});
test('expiry still clears an intermission or a foreground-only programme',()=>{
 assert.equal(expireCommunityProgramme({...programme,mode:'intermission'},true),null);
 assert.equal(expireCommunityProgramme(programme,false),null);
 assert.equal(expireCommunityProgramme(null,true),null);
});
