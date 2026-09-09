import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceGain, VOICE_RANGE, VOICE_RELEASE_RANGE } from '../shared/voice.ts';
test('voice gain is full nearby, attenuates, and has bounded admission/release hysteresis',()=>{
 const listener={x:0,z:-10};
 assert.equal(voiceGain(listener,listener),1);
 assert.equal(voiceGain(listener,{x:2,z:-10}),1);
 assert.equal(voiceGain(listener,{x:7,z:-10}),.5);
 assert.equal(voiceGain(listener,{x:VOICE_RANGE,z:-10}),0);
 assert.equal(voiceGain(listener,{x:VOICE_RANGE+.01,z:-10}),null);
 assert.equal(voiceGain(listener,{x:VOICE_RANGE+.01,z:-10},true),0);
 assert.equal(voiceGain(listener,{x:VOICE_RELEASE_RANGE,z:-10},true),0);
 assert.equal(voiceGain(listener,{x:VOICE_RELEASE_RANGE+.01,z:-10},true),null);
});
test('district boundaries reject nearby voices even when previously admitted',()=>{
 for(const admitted of [false,true]) {
  assert.equal(voiceGain({x:0,z:14},{x:0,z:14.01},admitted),null);
  assert.equal(voiceGain({x:18,z:0},{x:18.01,z:0},admitted),null);
 }
 assert.equal(voiceGain({x:0,z:16},{x:0,z:17}),1);
});
