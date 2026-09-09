import {webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('output/playwright/polish',{recursive:true});
const browser=await webkit.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,hasTouch:true,reducedMotion:'reduce'});
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
 await page.goto('http://localhost:5173');await page.getByRole('textbox',{name:'WHAT SHOULD WE CALL YOU?'}).fill('Comfort check');await page.getByRole('button',{name:'Enter',exact:true}).click();await page.getByRole('button',{name:'Join the square',exact:true}).waitFor();await page.waitForTimeout(700);
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
  await input.tap();await input.fill(`Touch chat ${size.width}`);await page.getByRole('button',{name:'Send message'}).tap();await page.getByRole('log').getByText(`Touch chat ${size.width}`,{exact:false}).waitFor();
  await page.locator('#world').tap({position:{x:170,y:150}});await page.getByRole('button',{name:'Toggle town chat'}).tap();
 }
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open settings'}).tap();
 assert.equal(await page.locator('html').getAttribute('data-reduced-motion'),'true');
 await page.getByRole('checkbox',{name:/Performance mode/}).check();await page.getByRole('combobox',{name:'Motion preference'}).selectOption('reduced');
 for(const label of ['Sound effects volume','Fountain ambience volume'])await page.getByRole('slider',{name:label}).fill('0');
 await page.waitForTimeout(300);
 report.audioMuted=await page.evaluate(()=>{const a=(window as any).audioEvidence;return {contexts:a.contexts.map((c:AudioContext)=>c.state),gains:a.gains.slice(0,2).map((g:GainNode)=>g.gain.value),sources:a.sources,stops:a.stops};});
 assert.deepEqual((report.audioMuted as {gains:number[]}).gains.map(n=>Math.round(n*100)),[0,0]);
 await page.screenshot({path:'output/playwright/polish/comfort-settings.png'});
 await page.reload();await page.getByRole('button',{name:'Enter',exact:true}).click();await page.getByRole('button',{name:'Join the square',exact:true}).click();await page.getByRole('button',{name:'Open settings'}).tap();
 assert.ok(await page.getByRole('checkbox',{name:/Performance mode/}).isChecked());assert.equal(await page.getByRole('combobox',{name:'Motion preference'}).inputValue(),'reduced');assert.equal(await page.getByRole('slider',{name:'Sound effects volume'}).inputValue(),'0');assert.equal(await page.getByRole('slider',{name:'Fountain ambience volume'}).inputValue(),'0');
 report.performanceCanvas=await page.locator('#world').evaluate((c:HTMLCanvasElement)=>({width:c.width,height:c.height}));assert.deepEqual(report.performanceCanvas,{width:390,height:844});
 // Device motion changes apply when Follow device is selected.
 await page.getByRole('combobox',{name:'Motion preference'}).selectOption('system');await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>document.documentElement.dataset.reducedMotion==='false');
 await page.getByRole('slider',{name:'Sound effects volume'}).fill('0.5');await page.getByRole('button',{name:'Close panel'}).click();await page.locator('#world').focus();await page.keyboard.down('w');await page.waitForTimeout(900);await page.keyboard.up('w');
 report.audioFootsteps=await page.evaluate(()=>{const a=(window as any).audioEvidence;return{contexts:a.contexts.map((c:AudioContext)=>c.state),sources:a.sources,stops:a.stops};});assert.ok((report.audioFootsteps as {sources:number}).sources>=1,'actual Web Audio footstep sources started');
 assert.deepEqual(errors,[]);report.errors=errors;await writeFile('output/playwright/polish/comfort-results.json',JSON.stringify(report,null,2));console.log('PASS: DPR sizing, 44px creation controls, portrait/landscape chat hit-testing and actual touch sends, saved comfort/motion/volume, Web Audio mute and footsteps.');
} catch(error) {await page.screenshot({path:'output/playwright/polish/comfort-failure.png'});throw error;} finally{await browser.close();}
