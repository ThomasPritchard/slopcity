import { webkit,chromium,type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
await mkdir('output/playwright',{recursive:true});
const chromiumRun=process.env.SHOP_BROWSER==='chromium';
const browser=await (chromiumRun?chromium:webkit).launch({headless:true});
const errors:string[]=[];
const context=await browser.newContext({viewport:chromiumRun?{width:960,height:720}:{width:1440,height:960}}),page=await context.newPage();
async function join(p:Page,name:string){p.on('pageerror',e=>errors.push(e.message));await p.goto('http://localhost:5173');await p.getByRole('textbox',{name:'WHAT SHOULD WE CALL YOU?'}).fill(name);await p.getByRole('button',{name:'Enter',exact:true}).click();await p.getByRole('button',{name:'Join the square',exact:true}).click();await p.getByRole('button',{name:'Open town map'}).waitFor();const welcome=p.getByRole('button',{name:'Dismiss welcome'});if(await welcome.isVisible())await welcome.click();if(chromiumRun){await p.getByRole('button',{name:'Open settings'}).click();await p.getByRole('combobox',{name:'Graphics quality'}).selectOption('medium');await p.getByRole('button',{name:'Close panel'}).click();}await p.evaluate(async()=>{const path='/node_modules/.vite/deps/@babylonjs_core_Engines_engine.js';const{Engine}=await import(path);(window as any).shopScene=Engine.Instances[0].scenes[0];});}
const wallet=(p:Page)=>p.evaluate(async()=>await(await fetch('/game/api/economy')).json());
async function position(){await page.getByRole('button',{name:'Open town map'}).click();const mark=page.locator('.town-map circle[fill="#253d33"]');const p={x:Number(await mark.getAttribute('cx')),z:-Number(await mark.getAttribute('cy'))};await page.getByRole('button',{name:'Close panel'}).click();return p;}
async function walk(axis:'x'|'z',target:number){for(let i=0;i<(chromiumRun?48:16);i++){const delta=target-(await position())[axis];if(Math.abs(delta)<.35)return;await page.evaluate(()=>{(window as any).shopScene.activeCamera.alpha=-Math.PI/2;});const key=axis==='x'?(delta>0?'d':'a'):(delta>0?'w':'s');await page.locator('#world').focus();await page.keyboard.down(key);await page.waitForTimeout(Math.min(1600,Math.max(70,Math.abs(delta)/4.2*1000)));await page.keyboard.up(key);await page.waitForTimeout(220);}throw Error(`Could not walk to ${axis}=${target}`);}
const visibleVariant=(p:Page,model:string)=>p.evaluate(model=>(window as any).shopScene.meshes.filter((m:any)=>!m.name.startsWith('shop-mannequin-')&&m.name.includes(`/wear_${model}__`)&&m.isEnabled()).length,model);
try{
 await join(page,'Tom');assert.equal((await wallet(page)).balance,1000);
 const otherContext=await browser.newContext({viewport:chromiumRun?{width:600,height:640}:{width:1000,height:800}}),other=await otherContext.newPage();await join(other,'Alex');
 await walk('x',14);await walk('z',-2);await walk('x',20.2);
 await page.getByRole('button',{name:'Browse Form & Thread'}).waitFor();
 // WebKit checks the brief animation; slow software Chromium may finish walking after it fades.
 if(!chromiumRun){
 await page.locator('.location').filter({hasText:'Form & Thread'}).waitFor();await page.waitForTimeout(400);
 const arrival=await page.locator('.location').boundingBox();assert.ok(arrival);assert.ok(Math.abs(arrival.x+arrival.width/2-page.viewportSize()!.width/2)<2 && Math.abs(arrival.y+arrival.height/2-page.viewportSize()!.height*.45)<2,'location announcement is horizontally centred at the approved 45% HUD anchor');
 await page.screenshot({path:'output/playwright/30-location-arrival.png'});
 await page.locator('.location').waitFor({state:'detached',timeout:5000});
 }
 await page.evaluate(()=>{const camera=(window as any).shopScene.activeCamera;camera.alpha=Math.PI;camera.beta=1.22;camera.radius=5.5;});await page.waitForTimeout(600);
 await page.screenshot({path:'output/playwright/24-shop-interior.png'});
 // Reach the new fitting lounge through the connected department openings.
 await walk('x',26.4);await walk('z',-4.35);await walk('x',29.8);await walk('z',-6.475);await walk('x',32.1);
 const rear=await position();assert.ok(rear.x>31.7 && rear.z<-6.1,'authoritative position reaches the expanded rear fitting lounge');
 await page.getByRole('button',{name:'Browse Form & Thread'}).click();
 await page.getByRole('button',{name:/Oat crewneck.*220 credits/}).click();await page.waitForTimeout(600);
 assert.ok(await visibleVariant(page,'knit')>0);assert.equal(await visibleVariant(other,'knit'),0);
 assert.equal((await wallet(page)).owned.includes('oat-knit'),false);
 await page.screenshot({path:'output/playwright/25-shop-try-on.png'});
 for(const [name,width,height] of [['portrait',390,844],['landscape',844,390]] as const){
   await page.setViewportSize({width,height});await page.waitForTimeout(500);
   const buy=await page.getByRole('button',{name:'Buy for 220 credits',exact:true}).boundingBox();
   assert.ok(buy&&buy.width>0&&buy.height>=44&&buy.x>=0&&buy.y>=0&&buy.x+buy.width<=width+1&&buy.y+buy.height<=height+1,`${name}: purchase control stays visible and usable`);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:`output/playwright/shop-mobile-${name}.png`});
 }
 await page.setViewportSize(chromiumRun?{width:960,height:720}:{width:1440,height:960});
 let purchaseRequest:unknown;
 await page.route('**/game/api/economy/purchase',async route=>{purchaseRequest=route.request().postDataJSON();await route.fetch();await route.abort();},{times:1});
 await page.getByRole('button',{name:'Buy for 220 credits',exact:true}).click();await page.locator('.shop-error').waitFor();
 assert.equal((await wallet(page)).balance,780);
 // The next salary snapshot may already recover the owned item before a UI retry.
 const replay=await page.evaluate(async body=>{const response=await fetch('/game/api/economy/purchase',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return{status:response.status,wallet:await response.json()};},purchaseRequest);assert.equal(replay.status,200);assert.equal(replay.wallet.balance,780);
 await page.getByRole('button',{name:'Wear this',exact:true}).waitFor();
 assert.equal((await wallet(page)).balance,780);assert.equal(await visibleVariant(other,'knit'),0);
 await page.getByRole('button',{name:'Wear this',exact:true}).click();await page.getByRole('button',{name:'Wearing this',exact:true}).waitFor();
 await other.waitForFunction(()=>(window as any).shopScene.meshes.some((m:any)=>!m.name.startsWith('shop-mannequin-')&&m.name.includes('/wear_knit__')&&m.isEnabled()),undefined,{polling:100});
 for(const [name,price] of [['Oxblood lace-up boots',480],['Straight indigo jeans',260]] as const){await page.getByRole('tab',{name:name.includes('boots')?'Shoes':'Trousers',exact:true}).click();await page.getByRole('button',{name:new RegExp(name)}).click();await page.getByRole('button',{name:`Buy for ${price} credits`,exact:true}).click();await page.getByRole('button',{name:'Wear this',exact:true}).click();await page.getByRole('button',{name:'Wearing this',exact:true}).waitFor();}
 assert.equal((await wallet(page)).balance,40);
 await page.getByRole('button',{name:/Moss cargo trousers/}).click();await page.getByRole('button',{name:'Not enough credits',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Not enough credits',exact:true}).isDisabled(),true);
 await page.getByRole('tab',{name:'Tops',exact:true}).click();await page.getByRole('button',{name:/Terracotta bomber/}).click();await page.waitForTimeout(500);await page.screenshot({path:'output/playwright/26-bomber-preview.png'});
 await page.getByRole('button',{name:'Leave clothing shop'}).click();assert.equal(await visibleVariant(page,'bomber'),0);
 await page.getByRole('button',{name:'Open wardrobe'}).click();assert.equal(await page.getByRole('button',{name:/Terracotta bomber/}).count(),0);
 await page.getByRole('button',{name:'View shoes',exact:true}).click();await page.waitForTimeout(400);await page.screenshot({path:'output/playwright/29-owned-boots.png'});
 await page.getByRole('button',{name:'View outfit',exact:true}).click();await page.waitForTimeout(500);await page.screenshot({path:'output/playwright/27-owned-outfit.png'});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);await page.screenshot({path:'output/playwright/28-mobile-wardrobe.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(500);await page.screenshot({path:'output/playwright/28-mobile-landscape-wardrobe.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByRole('button',{name:'Close wardrobe'}).click();await page.setViewportSize({width:1440,height:960});
 const saved=await wallet(page);assert.ok(saved.salaryProgressMs>5000,'real presence heartbeats accrue saved salary time');await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('button',{name:'Leave the square'}).click();await page.getByRole('textbox',{name:'WHAT SHOULD WE CALL YOU?'}).waitFor();await page.reload();
 await page.getByRole('button',{name:'Enter',exact:true}).waitFor();const restored=await wallet(page);assert.equal(restored.balance,40);assert.deepEqual(restored.outfit,saved.outfit);assert.deepEqual(restored.owned,saved.owned);assert.ok(restored.salaryProgressMs>=saved.salaryProgressMs);await page.waitForTimeout(2200);assert.equal((await wallet(page)).salaryProgressMs,restored.salaryProgressMs,'salary pauses outside town');
 assert.deepEqual(errors,[]);
 await writeFile(`output/playwright/economy-${chromiumRun?'chromium':'webkit'}-results.json`,JSON.stringify({checkedAt:new Date().toISOString(),browser:chromiumRun?'headless Chromium, performance mode':'headless WebKit',checks:['1000 grant','real walk through connected departments to expanded rear fitting lounge','private 3D try-on','lost response recovers through server snapshot; replay charges once','buy separate from equip','remote equipment replication','three clothing slots','insufficient funds','cancel restores outfit','owned-only wardrobe','portrait and short landscape layout','reload persistence',...(!chromiumRun?['centred arrival announcement fades out']:[]),'server presence accrual','salary paused outside town'],errors},null,2));
 console.log('PASS: shop and wardrobe integration with server presence accrual, private previews, retry-safe purchases, remote equip, affordability, mobile and persistence; no page errors.');
 await otherContext.close();
}catch(error){await page.screenshot({path:'output/playwright/economy-failure.png'}).catch(()=>{});throw error;}finally{await browser.close();}
