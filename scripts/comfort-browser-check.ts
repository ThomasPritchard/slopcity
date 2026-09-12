import {webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('output/playwright/polish',{recursive:true});
const browser=await webkit.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,hasTouch:true,reducedMotion:'reduce'});
const origin=process.env.GAME_URL||'http://localhost:5173';
const fixtureAdmission=process.env.COMFORT_FIXTURE_ADMISSION==='1';
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 const Native=window.AudioContext;
 (window as any).audioEvidence={contexts:[],gains:[],sources:0,stops:0};
 window.AudioContext=class extends Native {
  constructor(options?:AudioContextOptions){super(options);const record=(window as any).audioEvidence;record.contexts.push(this);}
  createGain(){const gain=super.createGain();(window as any).audioEvidence.gains.push(gain);return gain;}
  createBufferSource(){const source=super.createBufferSource(),start=source.start.bind(source),stop=source.stop.bind(source);source.start=(...args:Parameters<typeof source.start>)=>{(window as any).audioEvidence.sources++;return start(...args);};source.stop=(when?:number)=>{(window as any).audioEvidence.stops++;stop(when);};return source;}
 };
});
const report:Record<string,unknown>={scope:'Headless WebKit mobile emulation and actual Web Audio nodes; not physical-phone or human listening validation'};
try {
 if(fixtureAdmission){
  assert.equal(new URL(origin).hostname,'localhost');
  const status=await (await page.request.get(`${origin}/game/api/admission`)).json();
  assert.equal(status.siteKey,'admission-test-site','only the isolated admission fixture may simulate verification');
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*',route=>route.fulfill({contentType:'application/javascript',body:`window.turnstile={render(el,options){el.textContent='Verification test fixture';setTimeout(()=>options.callback('fixture-'+crypto.randomUUID()),10);return 'fixture';},remove(){},reset(){}};`}));
  report.admission='Simulated provider on an isolated local server; real HTTP and game WebSockets';
 }
 const completeFixtureCheck=async()=>{if(fixtureAdmission){await page.getByRole('dialog',{name:'A quick check before you join.'}).waitFor();await page.getByRole('button',{name:'Continue',exact:true}).click();}};
 await page.goto(origin);await page.getByRole('textbox',{name:'What should we call you?'}).fill('Comfort check');await page.getByRole('button',{name:'Choose your look',exact:true}).click();await completeFixtureCheck();await page.getByRole('button',{name:'Join the square',exact:true}).waitFor();await page.waitForTimeout(700);
 report.phoneCanvas=await page.locator('#world').evaluate((c:HTMLCanvasElement)=>({width:c.width,height:c.height,cssWidth:c.clientWidth,cssHeight:c.clientHeight}));
 const dimensions=report.phoneCanvas as {width:number;height:number;cssWidth:number;cssHeight:number};assert.ok(dimensions.width>=dimensions.cssWidth);assert.ok(Math.abs(dimensions.width/dimensions.height-dimensions.cssWidth/dimensions.cssHeight)<.005);
 for(const size of [{width:390,height:844},{width:320,height:740},{width:844,height:390}]) {
  await page.setViewportSize(size);await page.waitForTimeout(400);
  const controls=await page.locator('.custom-field .swatch,.preview-controls button').evaluateAll(elements=>elements.map(el=>({name:el.getAttribute('aria-label'),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
  assert.ok(controls.every(c=>c.width>=44&&c.height>=44),JSON.stringify(controls));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`output/playwright/polish/creator-${size.width}.png`});
 }
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Join the square',exact:true}).click();await page.getByRole('button',{name:'Open settings'}).waitFor();await page.waitForTimeout(1000);
 assert.equal(await page.locator('.chat-panel').count(),0,'phone chat starts compact');
 for(const size of [{width:390,height:844},{width:844,height:390}]) {
  await page.setViewportSize(size);await page.getByRole('button',{name:'Toggle town chat'}).tap();await page.waitForTimeout(400);
  const input=page.getByRole('textbox',{name:'Message to town'});
  const hit=await input.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width*.3,r.y+r.height/2)===el;});assert.ok(hit,'chat input is not covered by joystick');
  await page.screenshot({path:`output/playwright/polish/chat-${size.width}.png`});
  await page.waitForTimeout(900); // Respect the server's 800ms chat rate limit between automated sends.
  await input.tap();await input.fill(`Touch chat ${size.width}`);await page.getByRole('button',{name:'Send message'}).tap();
  // Short landscape deliberately hides chat history; still require the server echo.
  await page.locator('[role="log"]').getByText(`Touch chat ${size.width}`,{exact:false}).waitFor({state:'attached'});
  await page.locator('#world').tap({position:{x:170,y:150}});await page.getByRole('button',{name:'Toggle town chat'}).tap();
 }
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open settings'}).tap();
 assert.equal(await page.locator('html').getAttribute('data-reduced-motion'),'true');
 const graphics=page.getByRole('combobox',{name:'Graphics quality'});
 assert.equal(await graphics.inputValue(),'high','fresh phone settings use High without automatic downgrading');
 assert.deepEqual(await graphics.locator('option').allTextContents(),['Low','Medium','High','Ultra']);
 const highDescription=await page.locator('#graphics-quality-description').innerText();assert.ok(highDescription.trim());
 await graphics.selectOption('medium');await page.getByRole('combobox',{name:'Motion preference'}).selectOption('reduced');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('slop-city-comfort')||'{}').graphics==='medium');
 assert.notEqual(await page.locator('#graphics-quality-description').innerText(),highDescription,'description follows the selected preset');
 for(const label of ['Sound effects volume','Fountain ambience volume'])await page.getByRole('slider',{name:label}).fill('0');
 await page.waitForTimeout(300);
 report.audioMuted=await page.evaluate(()=>{const a=(window as any).audioEvidence;return {contexts:a.contexts.map((c:AudioContext)=>c.state),gains:a.gains.slice(0,2).map((g:GainNode)=>g.gain.value),sources:a.sources,stops:a.stops};});
 assert.deepEqual((report.audioMuted as {gains:number[]}).gains.map(n=>Math.round(n*100)),[0,0]);
 const settingsLayouts=[];
 for(const size of [{width:390,height:844},{width:320,height:740},{width:844,height:390}]) {
  await page.setViewportSize(size);await graphics.scrollIntoViewIfNeeded();await page.waitForTimeout(300);
  const control=await graphics.evaluate(el=>{const r=el.getBoundingClientRect();return{width:r.width,height:r.height,visible:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el};});
  assert.ok(control.width>=44&&control.height>=44&&control.visible,JSON.stringify({size,control}));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  settingsLayouts.push({viewport:size,control});
  await page.screenshot({path:`output/playwright/polish/comfort-settings-${size.width}.png`});
 }
 report.settingsLayouts=settingsLayouts;
 await page.setViewportSize({width:390,height:844});await graphics.scrollIntoViewIfNeeded();
 await page.screenshot({path:'output/playwright/polish/comfort-settings.png'});
 await page.reload();await page.getByRole('button',{name:'Choose your look',exact:true}).click();await page.getByRole('button',{name:'Join the square',exact:true}).click();await completeFixtureCheck();await page.getByRole('button',{name:'Open settings'}).tap();
 assert.equal(await graphics.inputValue(),'medium');assert.equal(await page.getByRole('combobox',{name:'Motion preference'}).inputValue(),'reduced');assert.equal(await page.getByRole('slider',{name:'Sound effects volume'}).inputValue(),'0');assert.equal(await page.getByRole('slider',{name:'Fountain ambience volume'}).inputValue(),'0');
 report.mediumCanvas=await page.locator('#world').evaluate((c:HTMLCanvasElement)=>({width:c.width,height:c.height}));assert.deepEqual(report.mediumCanvas,{width:390,height:844});
 report.savedPreferences=await page.evaluate(()=>JSON.parse(localStorage.getItem('slop-city-comfort')||'{}'));
 assert.deepEqual(report.savedPreferences,{graphics:'medium',motion:'reduced',effects:0,ambience:0});
 // Device motion changes apply when Follow device is selected.
 await page.getByRole('combobox',{name:'Motion preference'}).selectOption('system');await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>document.documentElement.dataset.reducedMotion==='false');
 await page.getByRole('slider',{name:'Sound effects volume'}).fill('0.5');await page.getByRole('button',{name:'Close panel'}).click();await page.locator('#world').focus();await page.keyboard.down('w');await page.waitForTimeout(900);await page.keyboard.up('w');
 report.audioFootsteps=await page.evaluate(()=>{const a=(window as any).audioEvidence;return{contexts:a.contexts.map((c:AudioContext)=>c.state),sources:a.sources,stops:a.stops};});assert.ok((report.audioFootsteps as {sources:number}).sources>=1,'actual Web Audio footstep sources started');
 assert.deepEqual(errors,[]);report.errors=errors;await writeFile('output/playwright/polish/comfort-results.json',JSON.stringify(report,null,2));console.log('PASS: DPR sizing, 44px creation and graphics controls, portrait/landscape settings and chat touch sends, High default and saved Medium graphics/motion/volume, Web Audio mute and footsteps.');
} catch(error) {await page.screenshot({path:'output/playwright/polish/comfort-failure.png'});throw error;} finally{await browser.close();}
