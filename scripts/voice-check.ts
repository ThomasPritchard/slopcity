import { chromium, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const errors:string[]=[];
async function join(page:Page,name:string) {
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://localhost:5173');
 await page.getByRole('textbox',{name:'What should we call you?'}).fill(name);
 await page.getByRole('button',{name:'Choose your look',exact:true}).click({timeout:90000});
 await page.getByRole('button',{name:'Join the square',exact:true}).click();
 await page.getByRole('button',{name:'Open neighbours'}).click();
 const responsePromise=page.waitForResponse(r=>r.url().endsWith('/voice/token'));
 await page.getByRole('button',{name:'Join voice',exact:true}).click();
 const response=await responsePromise;assert.equal(response.status(),200);
 const grant=await response.json();const claims=JSON.parse(Buffer.from(grant.token.split('.')[1],'base64url').toString());
 assert.equal(claims.video.canPublishData,false);assert.deepEqual(claims.video.canPublishSources,['microphone']);
 assert.ok(claims.exp-claims.nbf<=61);assert.ok(claims.sub);assert.ok(claims.video.room);
 await page.getByRole('button',{name:'Enable microphone',exact:true}).waitFor({timeout:30000});
 assert.equal(await page.getByText('Microphone off',{exact:true}).count(),1);
}
const audible=()=>[...document.querySelectorAll('audio')].some(audio=>audio.srcObject instanceof MediaStream && audio.srcObject.getAudioTracks().some(track=>track.readyState==='live') && !audio.paused && audio.currentTime>0);
try {
 const aContext=await browser.newContext({viewport:{width:1280,height:800}}),bContext=await browser.newContext({viewport:{width:1000,height:800}});
 await aContext.addInitScript(() => {
  const Original = window.RTCPeerConnection;
  (window as any).testPeerConnections = [];
  window.RTCPeerConnection = class extends Original {
   constructor(config?: RTCConfiguration) { super(config); (window as any).testPeerConnections.push(this); }
  };
 });
 const a=await aContext.newPage(),b=await bContext.newPage();
 await join(a,'Tom');await join(b,'Alex');
 await b.getByRole('button',{name:'Enable microphone',exact:true}).click();
 await b.getByRole('button',{name:'Turn off microphone',exact:true}).waitFor();
 await a.waitForFunction(audible,undefined,{timeout:20000});
 const audioStats = await a.evaluate(async () => {
  const reports = await Promise.all(((window as any).testPeerConnections as RTCPeerConnection[]).map(peer => peer.getStats()));
  return reports.flatMap(report => [...report.values()]).filter(stat => stat.type === 'inbound-rtp' && stat.kind === 'audio').map(stat => ({bytesReceived:stat.bytesReceived,totalSamplesReceived:stat.totalSamplesReceived}));
 });
 assert.ok(audioStats.some(stat=>stat.bytesReceived>0 && stat.totalSamplesReceived>0),'real inbound RTP audio samples received');
 await a.screenshot({path:'output/playwright/23-voice-connected.png'});
 console.log('PASS: two LiveKit participants, listening-first join, microphone-only token and synthetic audio reception.');
 await a.getByRole('button',{name:'Mute Alex',exact:true}).click();
 await a.waitForFunction(()=>document.querySelectorAll('audio').length===0);
 await a.getByRole('button',{name:'Mute Alex',exact:true}).click();await a.waitForFunction(audible);
 await a.getByRole('button',{name:'Block Alex',exact:true}).click();await a.waitForFunction(()=>document.querySelectorAll('audio').length===0);
 await a.locator('.social-blocked-person').getByRole('button',{name:'Unblock Alex'}).click();await a.waitForFunction(audible);
 await b.getByRole('button',{name:'Turn off microphone',exact:true}).click();await b.getByRole('button',{name:'Enable microphone',exact:true}).waitFor();
 await b.getByRole('button',{name:'Leave voice',exact:true}).click();await a.waitForFunction(()=>document.querySelectorAll('audio').length===0);
 await a.getByRole('button',{name:'Leave voice',exact:true}).click();
 await a.getByRole('button',{name:'Join voice',exact:true}).click();await a.getByRole('button',{name:'Enable microphone',exact:true}).waitFor();
 await b.getByRole('button',{name:'Join voice',exact:true}).click();await b.getByRole('button',{name:'Enable microphone',exact:true}).waitFor();
 await b.getByRole('button',{name:'Enable microphone',exact:true}).click();await a.waitForFunction(audible);
 await bContext.close();await a.waitForFunction(()=>document.querySelectorAll('audio').length===0);
 await a.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Synthetic denial', 'NotAllowedError'); }; });
 await a.getByRole('button',{name:'Enable microphone',exact:true}).click();
 await a.getByRole('alert').filter({hasText:'Microphone access was not available'}).waitFor();
 assert.equal(await a.getByRole('button',{name:'Leave voice',exact:true}).count(),1);
 await a.getByRole('button',{name:'Leave voice',exact:true}).click();
 await a.route('**/game/api/voice/token',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Voice is unavailable right now. You can still use town chat.'})}));
 await a.getByRole('button',{name:'Join voice',exact:true}).click();
 await a.getByRole('alert').filter({hasText:'Voice is unavailable right now'}).waitFor();
 await a.getByRole('button',{name:'Close neighbours panel'}).click();
 await a.getByRole('textbox',{name:'Message to town'}).fill('Chat still works.');await a.getByRole('button',{name:'Send message'}).click();await a.getByText('Chat still works.',{exact:false}).waitFor();
 assert.deepEqual(errors,[]);
 await writeFile('output/playwright/voice-results.json',JSON.stringify({checkedAt:new Date().toISOString(),browser:'headless Chromium with synthetic microphone',checks:['scoped microphone-only tokens','two participants','microphone off on join','received live audio track playback','neighbour mute/unmute','block/unblock removes/restores audio','own microphone toggle','leave/rejoin','town disconnect clears audio','microphone denial remains listening','voice unavailable leaves chat usable'],audioStats,errors,limits:'Synthetic audio only; not a physical microphone, human listening or mobile voice test.'},null,2));
 console.log('PASS: neighbour mute, block/unblock, own mic toggle, leave/rejoin, town disconnect cleanup; no page errors.');
 await aContext.close();
} finally {await browser.close();}
