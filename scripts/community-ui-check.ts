import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { webkit, type BrowserContext, type Locator, type Page } from 'playwright';
import { FIRST_MEMORY } from '../shared/memories.ts';
import { BRIDGEMIND_TWITCH_CHANNEL, COMMUNITY_LIMITS, communitySlide, type Programme, type ProgrammeSettings } from '../shared/community.ts';

const endpoint = process.env.GAME_URL || 'http://localhost:5173';
const output = 'output/playwright/community-ui';
// The optional isolated-preview access file is private, ignored state. Never print it.
const accessFile = process.env.COMMUNITY_ACCESS_FILE;
if (!accessFile) throw new Error('Set COMMUNITY_ACCESS_FILE to the isolated local acceptance admin access JSON.');
const access = JSON.parse(await readFile(accessFile, 'utf8')) as { password: string; origin: string };
assert.equal(new URL(endpoint).origin, access.origin, 'Acceptance credentials must belong to this isolated local origin');
assert.equal(new URL(endpoint).hostname, 'localhost', 'This test changes the disposable local community programme');
await mkdir(output, { recursive: true });
const browser = await webkit.launch({ headless: true });
const errors: string[] = [];
const checks: string[] = [];
let sharedReel: { elapsedMs: number; clockSkewMs: number; before: unknown; after: unknown } | undefined;
let page: Page | undefined;
// Only Twitch detection is controlled. Images, schedules, revisions and writes use the real API.
let mockedTwitchLive = false;
let savedProgrammeSettings: ProgrammeSettings | undefined;
function withMockedTwitch(programme: Programme): Programme {
 const curatedYouTube = savedProgrammeSettings?.mode === 'live' && savedProgrammeSettings.platform === 'youtube';
 return { ...programme,
  mode: mockedTwitchLive || curatedYouTube ? 'live' : 'intermission',
  platform: mockedTwitchLive ? 'twitch' : savedProgrammeSettings?.platform ?? programme.platform,
  twitchChannel: BRIDGEMIND_TWITCH_CHANNEL,
  youtubeVideoId: savedProgrammeSettings?.youtubeVideoId ?? programme.youtubeVideoId,
  liveDetection: { status: mockedTwitchLive ? 'live' : 'offline', checkedAt: programme.serverNowMs },
 };
}
async function mockTwitchDetection(context: BrowserContext) {
 await context.route(/\/game\/api\/community\/(programme|admin)$/, async route => {
  if (route.request().method() !== 'GET') { await route.continue(); return; }
  const response = await route.fetch();
  if (!response.ok()) { await route.fulfill({ response }); return; }
  const body = await response.json();
  if (new URL(route.request().url()).pathname.endsWith('/admin')) {
   savedProgrammeSettings = body.settings;
   await route.fulfill({ response, json: { ...body, programme: withMockedTwitch(body.programme) } });
  } else await route.fulfill({ response, json: withMockedTwitch(body) });
 });
}
async function visibleControl(control: Locator, height: number, width: number) {
 const box = await control.boundingBox(); assert.ok(box && box.height >= 44 && box.y >= 0 && box.y + box.height <= height && box.x >= 0 && box.x + box.width <= width, 'Control is visible and at least 44px high');
}
try {
 const context = await browser.newContext({ viewport: { width:1440, height:960 }, hasTouch:true });
 await mockTwitchDetection(context);
 await context.addInitScript(() => { localStorage.setItem('slop-city-comfort', JSON.stringify({ low:true, motion:'reduced', effects:0, ambience:0 })); if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw Error('No real microphone in community acceptance'); }; });
 // Provider documents are isolated: these checks prove deliberate mounting and layout, not live media.
 await context.route('https://player.twitch.tv/**', route => route.fulfill({ contentType:'text/html', body:'<!doctype html><html><meta charset="utf-8"><body style="margin:0;background:#10261b;color:#fff;font:18px sans-serif;display:grid;place-content:center;height:100vh"><p>Official player frame · local acceptance response</p><button>Provider playback control</button></body></html>' }));
 await context.route('https://www.youtube.com/embed/**', route => route.fulfill({ contentType:'text/html', body:'<!doctype html><html><meta charset="utf-8"><body style="margin:0;background:#10261b;color:#fff;font:18px sans-serif;display:grid;place-content:center;height:100vh"><p>YouTube frame · local acceptance response</p><button>Provider playback control</button></body></html>' }));
 page = await context.newPage(); page.setDefaultTimeout(30_000); page.on('pageerror', error => errors.push(error.message));
 await page.goto(endpoint); await page.getByRole('button', { name:'Enter', exact:true }).waitFor({ timeout:90_000 });
 await page.getByRole('button', { name:'Open our first community memory', exact:true }).click();
 let panel = page.getByRole('dialog', { name:'Slop City memories', exact:true }); await panel.waitFor();
 for (const [label,width,height] of [['desktop',1440,960],['portrait',390,844],['landscape',844,390]] as const) {
  await page.setViewportSize({ width,height }); await panel.locator('.community-content').evaluate(node => node.scrollTop=0);
  await visibleControl(panel.getByRole('button', { name:'Close community', exact:true }), height,width);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path:`${output}/board-${label}.png` });
  const photo = panel.getByRole('button', { name:`Open photo: ${FIRST_MEMORY.title}`, exact:true });
  await photo.click(); const detail = page.getByRole('dialog', { name:FIRST_MEMORY.title, exact:true });
  await detail.locator('img').evaluate(async (image:HTMLImageElement) => { if (!image.complete) await new Promise(resolve => image.addEventListener('load',resolve,{once:true})); });
  assert.equal(await detail.locator('img').evaluate((image:HTMLImageElement) => image.naturalWidth===1122 && image.naturalHeight===1402 && getComputedStyle(image).objectFit==='contain'), true);
  await visibleControl(detail.getByRole('button', { name:'Close photo', exact:true }),height,width);
  await page.screenshot({ path:`${output}/photo-${label}.png` });
  await detail.getByRole('button', { name:'Zoom photo in',exact:true }).click(); assert.equal(await detail.locator('output[aria-label="Photo zoom"]').textContent(),'150%');
  await page.keyboard.press('Escape'); await detail.waitFor({ state:'detached' }); assert.equal(await photo.evaluate(node => node===document.activeElement),true);
 }
 checks.push('Original 1122×1402 image uncropped at desktop, portrait and short landscape; close visible; Escape returns focus to selected Polaroid');
 await page.setViewportSize({ width:1440,height:960 });
 await panel.getByRole('button',{name:'Zoom board in',exact:true}).click(); assert.equal(await panel.locator('output[aria-label="Board zoom"]').textContent(),'125%');
 await page.keyboard.press('Escape'); await panel.waitFor({state:'detached'}); assert.equal(await page.getByRole('button',{name:'Open our first community memory',exact:true}).evaluate(node=>node===document.activeElement),true);
 await page.getByRole('textbox',{name:'WHAT SHOULD WE CALL YOU?'}).fill('Community acceptance');
 await page.getByRole('button',{name:'Enter',exact:true}).click(); await page.getByRole('button',{name:'Join the square',exact:true}).click();
 await page.getByRole('button',{name:'Open community memories',exact:true}).waitFor(); const welcome=page.getByRole('button',{name:'Dismiss welcome',exact:true});if(await welcome.isVisible())await welcome.click();
 await page.getByRole('button',{name:'Open community memories',exact:true}).click(); panel=page.getByRole('dialog',{name:'Slop City memories',exact:true});
 // Real programme clock, images and client polling with mocked Twitch offline status and an independently skewed browser clock.
 // Samples are at least 2.2 seconds from a slide boundary; one real advance takes <=24.4 seconds.
 const reelStarted = performance.now(), skewedContext = await browser.newContext({ viewport:{width:1440,height:960} });
 try {
  await mockTwitchDetection(skewedContext);
  await skewedContext.addInitScript(() => { const now=Date.now.bind(Date); Date.now=()=>now()+20_000; localStorage.setItem('slop-city-comfort',JSON.stringify({low:true,motion:'reduced',effects:0,ambience:0})); if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error('No real microphone in shared reel acceptance');}; });
  const skewedPage=await skewedContext.newPage();skewedPage.on('pageerror',error=>errors.push(error.message));
  const remaining=()=>Math.max(1,30_000-(performance.now()-reelStarted));
  await skewedPage.goto(endpoint,{timeout:remaining()});await skewedPage.getByRole('button',{name:'Open our first community memory',exact:true}).click({timeout:remaining()});
  await skewedPage.getByRole('dialog',{name:'Slop City memories',exact:true}).getByRole('button',{name:'Picture house',exact:true}).click({timeout:remaining()});
  await panel.getByRole('button',{name:'Picture house',exact:true}).click();
  const publicProgramme=()=>page!.evaluate(async()=>{const response=await fetch('/game/api/community/programme');if(!response.ok)throw Error(`Programme unavailable: ${response.status}`);return await response.json() as Programme;});
  const phase=(value:Programme)=>(value.serverNowMs-value.epochMs)%COMMUNITY_LIMITS.slideMs;
  const pause=async(ms:number)=>{assert.ok(ms<remaining(),'Shared reel check stays within its 30 second budget');await page!.waitForTimeout(ms);};
  let programme=await publicProgramme();assert.equal(programme.mode,'intermission','Shared timing acceptance requires the existing intermission programme');
  const margin=2200,initialPhase=phase(programme);
  if(initialPhase<margin)await pause(margin-initialPhase);
  else if(initialPhase>COMMUNITY_LIMITS.slideMs-margin)await pause(COMMUNITY_LIMITS.slideMs-initialPhase+margin);
  const reel=(target:Page)=>target.locator('.community-reel').evaluate(node=>{const image=node.querySelector('figure img');if(image)return{kind:'image',imageUrl:image.getAttribute('src')};if(node.querySelector('.community-schedule'))return{kind:'schedule'};throw Error('Expected an intermission image or schedule');});
  const sample=async()=>{
   const value=await publicProgramme(),currentPhase=phase(value);assert.ok(currentPhase>=2000&&currentPhase<=COMMUNITY_LIMITS.slideMs-2000,'Sample is away from the slide boundary');
   const [normal,skewed]=await Promise.all([reel(page!),reel(skewedPage)]),expected=communitySlide(value),key=expected.kind==='image'?{kind:'image',imageUrl:expected.image.imageUrl}:{kind:'schedule'};
   assert.deepEqual(normal,key,'Normal clock follows the real public programme');assert.deepEqual(skewed,normal,'A browser clock 20 seconds ahead shows the same slide');
   return {revision:value.revision,slideIndex:Math.floor((value.serverNowMs-value.epochMs)/COMMUNITY_LIMITS.slideMs),phaseMs:currentPhase,reel:normal,programme:value};
  };
  const before=await sample();
  const [normalNow,skewedNow]=await Promise.all([page.evaluate(()=>Date.now()),skewedPage.evaluate(()=>Date.now())]),clockSkewMs=skewedNow-normalNow;
  assert.ok(Math.abs(clockSkewMs-20_000)<500,'The second browser clock is actually skewed by 20 seconds');
  await pause(COMMUNITY_LIMITS.slideMs-phase(before.programme)+margin);
  const after=await sample();assert.equal(after.revision,before.revision,'No programme mutation created the transition');assert.equal(after.slideIndex,before.slideIndex+1,'Both views advanced across one real slide boundary');assert.notDeepEqual(after.reel,before.reel,'The displayed reel content actually changed');
  sharedReel={elapsedMs:Math.round(performance.now()-reelStarted),clockSkewMs,before:{revision:before.revision,slideIndex:before.slideIndex,phaseMs:before.phaseMs,reel:before.reel},after:{revision:after.revision,slideIndex:after.slideIndex,phaseMs:after.phaseMs,reel:after.reel}};
  assert.ok(sharedReel.elapsedMs<=30_000,'Two-context acceptance adds at most 30 seconds');
  checks.push('Two real contexts with a 20-second browser clock skew match the real programme clock with mocked Twitch offline status and stay aligned across a real slide advance');
  console.log(`PASS: two-context real reel advance with +20s clock skew (${sharedReel.elapsedMs}ms)`);
  await page.getByRole('dialog',{name:'The Bridge Picture House',exact:true}).getByRole('button',{name:'Memories board',exact:true}).click();
  panel=page.getByRole('dialog',{name:'Slop City memories',exact:true});
 } finally { await skewedContext.close(); }
 await panel.getByRole('button',{name:'Share a memory',exact:true}).click();
 const form=panel.getByRole('form',{name:'Submit a community image',exact:true});
 await form.getByLabel('Community image',{exact:true}).setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('not an image')});
 await form.getByRole('alert').filter({hasText:'Choose a still JPEG'}).waitFor();
 await form.getByLabel('Community image',{exact:true}).setInputFiles('public/community/first-memory.png');
 const title=`UI acceptance memory ${Date.now()}`;
 await form.getByRole('textbox',{name:'Title',exact:true}).fill(title);await form.getByRole('textbox',{name:'Creator credit'}).fill('Local acceptance test');
 await page.route('**/game/api/community/submissions',route=>route.request().method()==='POST'?route.abort('failed'):route.continue(),{times:1});
 await form.getByRole('button',{name:'Send for review',exact:false}).click(); await form.getByRole('button',{name:'Try sending again',exact:true}).waitFor();
 await form.getByRole('button',{name:'Try sending again',exact:true}).click(); await form.getByRole('status').filter({hasText:'Sent to Tom'}).waitFor();
 await panel.locator('.community-submissions li').filter({hasText:title}).getByText('Waiting for review',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${output}/submission-portrait.png`});
 checks.push('Real guest upload, file validation, preview, failed-request retry, private pending owner status');
 const submission=await page.evaluate(async name=>{const body=await(await fetch('/game/api/community/submissions')).json();return body.submissions.find((item:{title:string})=>item.title===name);},title);
 assert.ok(submission?.id);
 const anon=await browser.newContext();const privateResponse=await anon.request.get(`${endpoint}${submission.imageUrl}`);assert.ok([401,404].includes(privateResponse.status()));await anon.close();
 await panel.getByRole('button',{name:'Tom’s review desk',exact:false}).click();let admin=page.getByRole('dialog',{name:'Community review desk',exact:true});
 await admin.getByLabel('Admin password',{exact:true}).fill(access.password);await admin.getByRole('button',{name:'Open the review desk',exact:true}).click();await admin.getByRole('button',{name:'Review queue',exact:false}).waitFor();
 let card=admin.locator('.community-review-image').filter({hasText:title});await card.waitFor();await card.getByRole('button',{name:`Preview submission: ${title}`,exact:true}).click();
 const review=page.getByRole('dialog',{name:title,exact:true});await review.getByRole('button',{name:'Back to review',exact:false}).click();
 await card.getByRole('button',{name:'Approve',exact:true}).click();await card.waitFor({state:'detached'});
 await admin.getByLabel('Show',{exact:true}).selectOption('approved');card=admin.locator('.community-review-image').filter({hasText:title});await card.waitFor();
 await card.getByRole('button',{name:'☆ Feature',exact:true}).click();await card.getByRole('button',{name:'★ Featured',exact:true}).waitFor();
 await card.getByLabel('Display order',{exact:true}).fill('12');await card.getByRole('button',{name:'Set order',exact:true}).click();await page.waitForFunction(async id=>{const data=await(await fetch('/game/api/community/admin')).json();return data.images.some((image:{id:string;sortOrder:number})=>image.id===id&&image.sortOrder===12);},submission.id);
 for(const [label,width,height]of[['desktop',1440,960],['portrait',390,844],['landscape',844,390]]as const){await page.setViewportSize({width,height});await admin.locator('.community-content').evaluate(node=>node.scrollTop=0);await visibleControl(admin.getByRole('button',{name:'Close community',exact:true}),height,width);await admin.getByLabel('Show',{exact:true}).scrollIntoViewIfNeeded();await visibleControl(admin.getByLabel('Show',{exact:true}),height,width);await page.screenshot({path:`${output}/review-${label}.png`});}
 await admin.getByRole('button',{name:'Memories board',exact:true}).click();panel=page.getByRole('dialog',{name:'Slop City memories',exact:true});await panel.getByRole('button',{name:`Open photo: ${title}`,exact:true}).waitFor();
 checks.push('Real admin login, private image preview, approval publication, feature and ordering; private media denied to anonymous context');
 await panel.getByRole('button',{name:'Tom’s review desk',exact:false}).click();admin=page.getByRole('dialog',{name:'Community review desk',exact:true});await admin.getByRole('button',{name:'Programme',exact:true}).click();
 mockedTwitchLive = true;
 await admin.getByLabel('Live platform',{exact:true}).selectOption('twitch');
 assert.equal(await admin.getByLabel('Screen mode',{exact:true}).isDisabled(),true);
 assert.equal(await admin.getByLabel('BridgeMind Twitch channel',{exact:true}).getAttribute('readonly'),'');
 await admin.getByRole('button',{name:'Add a scheduled stream',exact:false}).click();await admin.getByLabel('Event 1',{exact:true}).fill('Local acceptance screening');await admin.getByLabel('Starts at (UTC)',{exact:true}).fill('2026-09-12T18:30');
 await admin.getByRole('button',{name:'Save programme',exact:true}).click();await page.waitForFunction(async()=>{const value=await(await fetch('/game/api/community/programme')).json();return value.mode==='live'&&value.platform==='twitch'&&value.schedule.some((entry:{title:string})=>entry.title==='Local acceptance screening');});
 await admin.getByRole('button',{name:'Picture house',exact:true}).click();const cinema=page.getByRole('dialog',{name:'The Bridge Picture House',exact:true});
 await cinema.getByRole('button',{name:'Watch together',exact:false}).waitFor();assert.equal(await page.locator('iframe').count(),0,'No provider frame before deliberate Watch');
 for(const[label,width,height]of[['desktop',1440,960],['portrait',390,844],['landscape',844,390]]as const){await page.setViewportSize({width,height});await cinema.getByRole('button',{name:'Watch together',exact:false}).click();const watch=page.getByRole('dialog',{name:'Watch at The Bridge Picture House',exact:true});await visibleControl(watch.getByRole('button',{name:'Close player',exact:true}),height,width);if(width<400){assert.equal(await watch.locator('iframe').count(),0);await watch.getByRole('heading',{name:'A little more room for the show.',exact:true}).waitFor();await watch.getByRole('link',{name:'Open on Twitch',exact:false}).first().waitFor();}else{await watch.locator('iframe').waitFor();const box=await watch.locator('iframe').boundingBox();assert.ok(box&&box.width>=400&&box.height>=300);assert.match(await watch.locator('iframe').getAttribute('src')??'',/channel=bridgemindai&parent=localhost/);}await page.screenshot({path:`${output}/twitch-${label}.png`});await watch.getByRole('button',{name:'Close player',exact:true}).click();assert.equal(await page.locator('iframe').count(),0);}
 checks.push('Saved UTC schedule with mocked Twitch live detection; Twitch deliberately mounted, starts muted, portrait rotate/link fallback, desktop and 844×390 player >=400×300, close unmounts iframe');
 mockedTwitchLive = false;
 await cinema.getByRole('button',{name:'Tom’s review desk',exact:false}).click();admin=page.getByRole('dialog',{name:'Community review desk',exact:true});await admin.getByRole('button',{name:'Programme',exact:true}).click();await admin.getByLabel('Live platform',{exact:true}).selectOption('youtube');await admin.getByLabel('Screen mode',{exact:true}).selectOption('live');await admin.getByLabel('BridgeMind YouTube video ID',{exact:true}).fill('jNQXAC9IVRw');await admin.getByRole('button',{name:'Save programme',exact:true}).click();await page.waitForFunction(async()=>{const value=await(await fetch('/game/api/community/programme')).json();return value.platform==='youtube'&&value.mode==='live';});await admin.getByRole('button',{name:'Picture house',exact:true}).click();await page.setViewportSize({width:390,height:844});await cinema.getByRole('button',{name:'Watch together',exact:false}).click();const youtube=page.getByRole('dialog',{name:'Watch at The Bridge Picture House',exact:true});await youtube.locator('iframe').waitFor();assert.match(await youtube.locator('iframe').getAttribute('src')??'',/youtube.com\/embed\/jNQXAC9IVRw\?autoplay=1&mute=1&controls=1/);await page.screenshot({path:`${output}/youtube-portrait.png`});await page.keyboard.press('Escape');assert.equal(await page.locator('iframe').count(),0);
 checks.push('With mocked Twitch offline detection, curated YouTube ID uses official embed with visible controls, starts muted, fits portrait and unmounts on Escape; provider responses mocked, media unverified');
 // Leave the disposable town in intermission and remove the test image/schedule through real routes.
 await cinema.getByRole('button',{name:'Tom’s review desk',exact:false}).click();admin=page.getByRole('dialog',{name:'Community review desk',exact:true});await admin.getByRole('button',{name:'Programme',exact:true}).click();await admin.getByLabel('Screen mode',{exact:true}).selectOption('intermission');await admin.getByRole('button',{name:'Remove event 1',exact:true}).click();await admin.getByRole('button',{name:'Save programme',exact:true}).click();await page.waitForFunction(async()=>{const value=await(await fetch('/game/api/community/programme')).json();return value.mode==='intermission';});
 await admin.getByRole('button',{name:'Review queue',exact:false}).click();await admin.getByLabel('Show',{exact:true}).selectOption('approved');card=admin.locator('.community-review-image').filter({hasText:title});await card.getByRole('button',{name:'Reject',exact:true}).click();await card.waitFor({state:'detached'});await admin.getByLabel('Show',{exact:true}).selectOption('rejected');card=admin.locator('.community-review-image').filter({hasText:title});await card.getByRole('button',{name:'Remove',exact:true}).click();await card.getByRole('button',{name:'Remove image',exact:true}).click();await card.waitFor({state:'detached'});await admin.getByRole('button',{name:'Sign out',exact:true}).click();await admin.getByLabel('Admin password',{exact:true}).waitFor();
 checks.push('Rejection, explicit permanent removal and admin sign out');
 assert.deepEqual(errors,[]);
 await writeFile(`${output}/results.json`,JSON.stringify({checkedAt:new Date().toISOString(),endpoint,checks,sharedReel,errors,limits:['Headless WebKit emulates viewport sizes; no physical device performance claim.','Twitch live/offline status is a browser response fixture over the real local API; no live detection proof.', 'Provider documents locally fulfilled; no live broadcast or audio proof.']},null,2));
 console.log(`PASS: ${checks.length} community UI journeys; results in ${output}/results.json`);
} catch(error) {await page?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}finally{await browser.close();}
