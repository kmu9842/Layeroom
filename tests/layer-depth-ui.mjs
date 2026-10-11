import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

const root=process.cwd(),base=process.env.LAYEROOM_TEST_URL||'http://127.0.0.1:8765';
const parent=path.resolve(process.env.LAYEROOM_TEST_CARDS||'data/cards');
const initial=await(await fetch(base+'/api/cards')).json();
const source=initial.find(c=>c.segmentation!=='psd'&&c.layers.length>2);assert.ok(source);
const id='test-'+randomUUID(),folder=path.join(parent,id),out=path.resolve('test-results');
assert.equal(path.dirname(folder),parent);await fs.mkdir(out,{recursive:true});
await fs.cp(path.join(parent,source.id),folder,{recursive:true,errorOnExist:true,force:false});
const manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
manifest.id=id;manifest.title='Z position check';manifest.settings={layer_gap:.025,breathing:false};
await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest));
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1120},colorScheme:'light'}),errors=[];
page.on('pageerror',e=>errors.push(e.message));let native,nativePage;
const host=page.locator('.viewer-host');
const z=async()=>JSON.parse(await host.getAttribute('data-layer-z'));
const order=async()=>page.locator('.layer-list .layer-row').evaluateAll(rows=>rows.map(r=>+r.dataset.layerId));
const front=manifest.layers.at(-1),back=manifest.layers[0];
const ready=async()=>{await page.locator('.stage-loading').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('.viewer-host')?.dataset.layerZ);};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
async function open(){await page.goto(base);await page.locator(`.gallery-card[data-card-id="${id}"]`).click();await ready();}
try{
 await open();const before=await z(),cavity=Number(await host.getAttribute('data-frame-depth'));
 await page.getByRole('button',{name:`${front.name} Z 위치 조절`,exact:true}).click();
 const slider=page.getByRole('slider',{name:`${front.name} Z 위치`,exact:true});
 await slider.fill('73.5');await slider.press('Tab');await page.waitForTimeout(100);
 near((await z())[front.id],-.735*cavity);
 for(const layer of manifest.layers.filter(l=>l.id!==front.id))near((await z())[layer.id],before[layer.id]);
 assert.deepEqual(await order(),(await host.getAttribute('data-layer-order')).split(',').map(Number));
 const numeric=page.getByRole('spinbutton',{name:`${front.name} Z 위치 값`,exact:true});
 await numeric.fill('75.3');await numeric.press('Enter');await page.waitForTimeout(80);near((await z())[front.id],-.753*cavity);
 await numeric.fill('101');await numeric.press('Tab');assert.equal(await numeric.inputValue(),'75.3');
 // Changing global spacing keeps relative coordinates, including zero thickness.
 await page.locator('#layer-gap').fill('0');await page.waitForFunction(()=>Object.values(JSON.parse(document.querySelector('.viewer-host').dataset.layerZ)).every(z=>z===0));
 assert.equal(await slider.isDisabled(),true);await page.locator('#layer-gap').fill('0.05');await page.waitForTimeout(80);
 near((await z())[front.id],-.753*cavity*2);assert.equal(await slider.isDisabled(),false);
 const save=page.waitForResponse(r=>r.url().endsWith(`/api/cards/${id}/settings`)&&r.request().method()==='PATCH');
 await page.getByRole('button',{name:'액자 설정 저장',exact:true}).click();assert.equal((await save).status(),200);
 await open();near((await z())[front.id],-.753*cavity*2);
 // A second unsaved depth is included in the downloaded, independently running widget.
 await page.getByRole('button',{name:`${back.name} Z 위치 조절`,exact:true}).click();
 const backSlider=page.getByRole('slider',{name:`${back.name} Z 위치`,exact:true});await backSlider.fill('10');await backSlider.press('Tab');await page.waitForTimeout(80);
 const expected=await z(),expectedOrder=await host.getAttribute('data-layer-order');
 await page.locator('.layer-position-control').scrollIntoViewIfNeeded();
 const layout=await page.locator('.position-open').evaluate(row=>{const r=row.getBoundingClientRect(),c=row.querySelector('.layer-position-control').getBoundingClientRect(),next=row.nextElementSibling?.getBoundingClientRect();return{bottom:r.bottom,controlBottom:c.bottom,controlHeight:c.height,nextTop:next?.top};});
 assert.ok(layout.controlHeight>70&&layout.controlBottom<=layout.bottom&&(!layout.nextTop||layout.nextTop>=layout.bottom),'Expanded Z control must fit within its row without overlapping neighbors');
 await page.screenshot({path:path.join(out,'layer-depth-light.png')});
 await page.emulateMedia({colorScheme:'dark'});await page.waitForTimeout(100);await page.screenshot({path:path.join(out,'layer-depth-dark.png')});
 const download=page.waitForEvent('download',{timeout:120000});await page.getByRole('button',{name:'위젯으로 받기',exact:true}).click();
 const executable=path.join(out,'layer-depth-widget.exe');await(await download).saveAs(executable);
 const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
 const child=spawn(executable,[],{windowsHide:true,stdio:'ignore',env:{...process.env,LAYEROOM_WIDGET_TEST_PORT:String(port)}});child.unref();
 let endpoint;for(let i=0;i<300;i++){try{endpoint=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();break;}catch{await new Promise(r=>setTimeout(r,200));}}assert.ok(endpoint);
 native=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);nativePage=native.contexts()[0].pages()[0];nativePage.on('pageerror',e=>errors.push(e.message));
 await nativePage.waitForSelector('.widget-shell[data-ready=true]');await nativePage.waitForFunction(()=>document.querySelector('.viewer-host').dataset.layerZ);
 assert.deepEqual(JSON.parse(await nativePage.locator('.viewer-host').getAttribute('data-layer-z')),expected);
 assert.equal(await nativePage.locator('.viewer-host').getAttribute('data-layer-order'),expectedOrder);
 const snapshot=await nativePage.evaluate(async()=>(await window.widget.initialize()).snapshot.card.settings);
 assert.equal(snapshot.layer_z[String(back.id)],.1);assert.equal(snapshot.layer_z[String(front.id)],.753);
 const saved=await(await fetch(`${base}/api/cards/${id}`)).json();assert.equal(saved.settings.layer_z[String(back.id)],1,'Widget export must not save unsaved changes');
 await nativePage.evaluate(()=>window.widget.close());await native.close();native=null;nativePage=null;
 // Reset only positions, then restore original PSD/segmentation order.
 await page.getByRole('button',{name:'Z 위치 균등 배치',exact:true}).click();await page.waitForTimeout(80);
 const uniform=await z(),currentOrder=await order();currentOrder.forEach((id,i)=>near(uniform[id],-i*.05));
 await page.getByRole('button',{name:'원본 순서 복원',exact:true}).click();await page.waitForTimeout(80);
 assert.deepEqual(await order(),manifest.layers.map(l=>l.id).reverse());
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:`${front.name} Z 위치 조절`,exact:true}).click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'layer-depth-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 const after=await(await fetch(base+'/api/cards')).json();for(const card of initial)assert.deepEqual(after.find(c=>c.id===card.id),card);
 console.log('PASS: per-layer Z controls, crossing order, other layers fixed, saved/reopened depth, global/zero spacing, exact widget snapshot+render, uniform/original reset, dark/mobile and original artwork preserved.');
}finally{
 if(nativePage&&!nativePage.isClosed())await nativePage.evaluate(()=>window.widget.close()).catch(()=>{});
 await native?.close().catch(()=>{});await browser.close();
 assert.equal(path.dirname(folder),parent);assert.ok(id.startsWith('test-'));await fs.rm(folder,{recursive:true,force:true});
}
