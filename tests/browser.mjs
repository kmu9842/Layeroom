import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root=process.cwd(),output=path.join(root,'test-results'),base='http://127.0.0.1:8765';await fs.mkdir(output,{recursive:true});
execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-X','utf8','scripts/psd_test_fixture.py',path.join(output,'order-fixture.psd')]);
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1120},deviceScaleFactor:1,colorScheme:'light'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const ready=async()=>{await page.locator('.stage-loading').waitFor({state:'hidden'});await page.waitForTimeout(200);};
const collection=async()=>{await page.getByRole('button',{name:/^컬렉션/}).click();await page.locator('.gallery-card').first().waitFor();};
async function dragLayer(from,to){
 const source=page.getByRole('button',{name:`${from} 순서 이동`,exact:true}),target=page.getByRole('button',{name:`${to} 순서 이동`,exact:true});
 await source.scrollIntoViewIfNeeded();const a=await source.boundingBox(),b=await target.boundingBox();
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2,a.y+a.height/2-8,{steps:2});await page.waitForTimeout(100);await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await page.waitForTimeout(200);await page.mouse.up();await page.waitForTimeout(250);
}
let testCardId;
const originalCards=await (await page.request.get(base+'/api/cards')).json();
const originalIds=new Set(originalCards.map(c=>c.id));
try{
 await page.goto(base);await page.locator('.gallery-card').first().waitFor();assert.equal(await page.locator('.gallery-card').count(),originalCards.length);
 for(let i=1;i<=4;i++){
  await collection();await page.locator(`.gallery-card[data-card-id="sample-0${i}"]`).click();await ready();
  assert.equal(await page.locator('#layer-gap').inputValue(),String(originalCards.find(c=>c.id===`sample-0${i}`).settings.layer_gap));
  const host=page.locator('.viewer-host');
  assert.equal(await host.getAttribute('data-front-z'),'0');
  await page.waitForFunction(()=>Number(document.querySelector('.viewer-host').dataset.supports)>0);
  await page.locator('#support-layers').uncheck();await page.waitForFunction(()=>document.querySelector('.viewer-host').dataset.supports==='0');await page.locator('#support-layers').check();
  assert.equal(-Number(await host.getAttribute('data-back-z')),Number(await host.getAttribute('data-frame-depth')));
  await page.locator('#breathing-toggle').uncheck();await page.getByRole('button',{name:'정면으로',exact:true}).click();
  await page.screenshot({path:path.join(output,`sample-0${i}-front.png`),fullPage:true});
  const metadata=originalCards.find(c=>c.id===`sample-0${i}`);
  assert.deepEqual((await host.getAttribute('data-layer-order')).split(',').map(Number),metadata.layers.map(l=>l.id).reverse());
  assert.equal(await page.locator('#edge-smoothing').isChecked(),true);
  await page.getByRole('button',{name:'레이어',exact:true}).click();await page.getByRole('button',{name:'회전 초기화',exact:true}).click();await page.waitForTimeout(400);
  await page.screenshot({path:path.join(output,`sample-0${i}-separated.png`),fullPage:true});
  for(const name of ['분절','깊이','원본 보기','입체 액자'])await page.getByRole('button',{name,exact:true}).click();
 }
 await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 await page.screenshot({path:path.join(output,'dark-studio.png'),fullPage:true});
 await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');

 // Capture the ID returned by this exact upload. Never infer ownership from a card- prefix.
 await page.getByRole('button',{name:'이미지 가져오기',exact:true}).click();
 const posted=page.waitForResponse(r=>r.url()===base+'/api/upload'&&r.request().method()==='POST');
 await page.locator('.upload-modal input[type=file]').setInputFiles(path.join(output,'order-fixture.psd'));
 const upload=await (await posted).json();testCardId=upload.card_id;
 assert.ok(testCardId&&!originalIds.has(testCardId));
 await page.locator('.upload-modal').waitFor({state:'hidden',timeout:30000});await ready();
 const names=()=>page.locator('.layer-list .layer-name').allTextContents();
 assert.deepEqual(await names(),['Hidden','Sleeve top','Hair middle','Face bottom']);
 assert.equal(await page.getByRole('button',{name:'경계 수정',exact:true}).count(),0);
 assert.equal(await page.getByRole('checkbox',{name:'Hair middle 움직임',exact:true}).isChecked(),false);
 assert.equal(await page.locator('#breathing-toggle').isChecked(),false);
 assert.equal(await page.locator('#layer-gap').inputValue(),'0.025');
 assert.equal(await page.locator('#layer-gap').getAttribute('min'),'0');
 assert.equal(await page.locator('#layer-gap').getAttribute('max'),'0.1');
 assert.equal(await page.locator('#layer-gap').getAttribute('step'),'0.005');
 assert.equal(await page.locator('#physics-toggle').count(),0);
 assert.equal(await page.getByRole('checkbox',{name:'Sleeve top 움직임',exact:true}).isChecked(),false);
 await page.getByRole('button',{name:'Hidden 표시',exact:true}).click();
 await page.getByRole('checkbox',{name:'Sleeve top 움직임',exact:true}).check();
 await dragLayer('Hair middle','Sleeve top');
 assert.deepEqual(await names(),['Hidden','Hair middle','Sleeve top','Face bottom']);
 await page.getByRole('button',{name:'원본 순서 복원',exact:true}).click();
 assert.deepEqual(await names(),['Hidden','Sleeve top','Hair middle','Face bottom']);
 const handle=page.getByRole('button',{name:'Hair middle 순서 이동',exact:true});await page.waitForTimeout(300);await handle.focus();await page.keyboard.press('Space');await page.locator('.layer-drag-overlay').waitFor({state:'visible'});await page.waitForTimeout(100);await page.keyboard.press('ArrowUp');await page.waitForTimeout(300);await page.keyboard.press('Space');await page.waitForTimeout(300);
 assert.deepEqual(await names(),['Hidden','Hair middle','Sleeve top','Face bottom']);
 await page.getByRole('button',{name:'액자 이름 수정',exact:true}).click();await page.getByRole('textbox',{name:'액자 이름',exact:true}).fill('PSD 순서 저장 검사');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('.stage-title').textContent.includes('PSD 순서 저장 검사'));
 await page.getByRole('button',{name:'액자 이름 수정',exact:true}).click();await page.getByRole('textbox',{name:'액자 이름',exact:true}).fill('취소할 이름');await page.keyboard.press('Escape');
 assert.ok((await page.locator('.stage-title').innerText()).includes('PSD 순서 저장 검사'));
 await page.locator('#layer-gap').fill('0');await page.waitForFunction(()=>document.querySelector('.viewer-host').dataset.frameDepth==='0');
 await page.locator('#layer-gap').fill('0.035');await page.locator('#angle-limit').fill('58');await page.locator('#breathing-toggle').check();await page.locator('#motion-amount').fill('1.4');await page.locator('#motion-duration').fill('8');
 await page.locator('#frame-theme').selectOption('silver');
 const saved=page.waitForResponse(r=>r.url().endsWith(`/api/cards/${testCardId}/settings`)&&r.request().method()==='PATCH');
 await page.getByRole('button',{name:'액자 설정 저장',exact:true}).click();assert.equal((await saved).status(),200);
 await page.reload();await page.locator(`.gallery-card[data-card-id="${testCardId}"]`).click();await ready();
 assert.equal(await page.locator('#frame-theme').inputValue(),'silver');
 assert.equal(await page.locator('#layer-gap').inputValue(),'0.035');assert.equal(await page.locator('#angle-limit').inputValue(),'58');
 assert.equal(await page.locator('#motion-amount').inputValue(),'1.4');assert.deepEqual(await names(),['Hidden','Hair middle','Sleeve top','Face bottom']);
 assert.equal(await page.getByRole('checkbox',{name:'Sleeve top 움직임',exact:true}).isChecked(),true);
 assert.equal(await page.getByRole('button',{name:'Hidden 숨기기',exact:true}).count(),1);
 const host=page.locator('.viewer-host'),box=await host.boundingBox();
 await page.mouse.move(box.x+box.width*.4,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.4+230,box.y+box.height*.5,{steps:12});await page.mouse.up();
 await page.waitForTimeout(50);const releasedRotation=await host.getAttribute('data-rotation-y');await page.waitForTimeout(300);
 assert.equal(await host.getAttribute('data-rotation-y'),releasedRotation,'Rotation must stop immediately after release');
 assert.ok(Number(await host.getAttribute('data-rotation-y'))>.8,'Dragging must reach beyond the previous 12° limit');
 await page.screenshot({path:path.join(output,'psd-deep-frame.png'),fullPage:true});
 await page.getByRole('button',{name:'정면으로',exact:true}).click();await page.mouse.move(5,5);
 await page.getByRole('checkbox',{name:'Hair middle 움직임',exact:true}).check();
 const first=await page.locator('.viewer-host canvas').screenshot();await page.waitForTimeout(1000);const second=await page.locator('.viewer-host canvas').screenshot();assert.ok(!first.equals(second),'Selected layers must animate');
 await page.locator('#breathing-toggle').uncheck();await page.waitForTimeout(50);
 const still1=await page.locator('.viewer-host canvas').screenshot();await page.waitForTimeout(300);const still2=await page.locator('.viewer-host canvas').screenshot();assert.ok(still1.equals(still2),'Motion off must produce a stationary frame');
 for(const checkbox of await page.locator('.layer-motion-check input').all())await checkbox.uncheck();
 await page.locator('#breathing-toggle').check();await page.mouse.move(5,5);await page.waitForTimeout(300);
 const fixed1=await page.locator('.viewer-host canvas').screenshot();await page.waitForTimeout(350);const fixed2=await page.locator('.viewer-host canvas').screenshot();assert.ok(fixed1.equals(fixed2),'Unchecked layers must stay fixed with global movement enabled');
 const png=page.waitForEvent('download');await page.getByRole('button',{name:'액자 PNG',exact:true}).click();await (await png).saveAs(path.join(output,'new-frame-export.png'));
 const zip=page.waitForEvent('download');await page.getByRole('link',{name:'레이어 ZIP',exact:true}).click();await (await zip).saveAs(path.join(output,'psd-layers.zip'));
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,'new-mobile.png'),fullPage:true});
 const touchSource=page.getByRole('button',{name:'Hair middle 순서 이동',exact:true}),touchTarget=page.getByRole('button',{name:'Sleeve top 순서 이동',exact:true});await touchSource.scrollIntoViewIfNeeded();
 const a=await touchSource.boundingBox(),b=await touchTarget.boundingBox(),cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+30,y:a.y+a.height/2}]});await page.waitForTimeout(250);
 for(let step=1;step<=8;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+30,y:a.y+a.height/2+(b.y-a.y)*step/8}]});await page.waitForTimeout(25);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(300);assert.deepEqual(await names(),['Hidden','Sleeve top','Hair middle','Face bottom']);
 assert.deepEqual(errors,[]);
 const after=await (await page.request.get(base+'/api/cards')).json();
 for(const original of originalCards)assert.deepEqual(after.find(c=>c.id===original.id),original,'Existing cards must not be changed by tests');
 console.log('PASS: four samples; physical cavity; themes; PSD upload and exact nested/hidden order; mouse drag / keyboard reorder / reset; rename; persisted gap/angle/motion/visibility; >45° drag; animation on/off; PNG/ZIP; mobile; existing library untouched.');
}finally{
 await browser.close();
 if(testCardId&&!originalIds.has(testCardId)){
  const target=path.resolve(root,'data/cards',testCardId),parent=path.resolve(root,'data/cards');
  if(!/^card-[a-f0-9]{12}$/.test(testCardId)||path.dirname(target)!==parent)throw Error('Invalid test cleanup path');
  await fs.rm(target,{recursive:true,force:true});
 }
}
