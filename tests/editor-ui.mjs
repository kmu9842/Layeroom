import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const root=process.cwd(),base='http://127.0.0.1:8765',out=path.resolve('test-results');await fs.mkdir(out,{recursive:true});
const original=await (await fetch(base+'/api/cards')).json();
const id='test-'+randomUUID(),parent=path.resolve('data/cards'),folder=path.join(parent,id);
assert.equal(path.dirname(folder),parent);assert.ok(!original.some(c=>c.id===id));
await fs.cp(path.join(parent,'sample-04'),folder,{recursive:true,errorOnExist:true,force:false});
const manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));manifest.id=id;manifest.title='경계 수정 테스트';await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest));
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1120},colorScheme:'light'}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
async function collection(){await page.getByRole('button',{name:/^컬렉션/}).click();await page.locator('.gallery-card').first().waitFor();}
async function pick(cardId=id){await page.locator(`.gallery-card[data-card-id="${cardId}"]`).click();await page.locator('.stage-loading').waitFor({state:'hidden'});}
async function sameHeight(){const a=await page.locator('.stage').boundingBox(),b=await page.locator('.inspector').boundingBox();assert.ok(Math.abs(a.height-b.height)<1,JSON.stringify({a,b}));}
async function sameCards(){const dimensions=await page.locator('.gallery-card').evaluateAll(cards=>cards.map(c=>{const b=c.getBoundingClientRect();return[b.width,b.height];}));for(const d of dimensions)assert.ok(Math.abs(d[0]-dimensions[0][0])<1&&d[1]===dimensions[0][1]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const add=await page.locator('.gallery-import').boundingBox(),first=await page.locator('.gallery-card').first().boundingBox();assert.ok(add.y+add.height<first.y);}
const pixel=async(x,y)=>page.locator('.paint-canvas').evaluate((c,[x,y])=>[...c.getContext('2d').getImageData(x,y,1,1).data],[x,y]);
const canvasPoint=async(x,y)=>{const r=await page.locator('.paint-canvas').boundingBox();return{x:r.x+x/manifest.width*r.width,y:r.y+y/manifest.height*r.height};};
const clickPixel=async(x,y)=>{const p=await canvasPoint(x,y);await page.mouse.click(p.x,p.y);await page.waitForTimeout(70);};
const stroke=async(from,to)=>{const a=await canvasPoint(...from),b=await canvasPoint(...to);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();await page.waitForTimeout(70);};
try{
 await page.goto(base);await page.locator('.gallery-card').first().waitFor();await sameCards();await pick();await sameHeight();
 assert.equal(await page.getByText('시스템 테마',{exact:true}).count(),0);assert.equal(await page.getByText('등록 이미지',{exact:true}).count(),0);assert.equal(await page.locator('.collection-strip').count(),0);
 // Every preset updates the WebGL frame, and preview stays to the right of the dropdown.
 const options=await page.locator('#frame-theme option').evaluateAll(os=>os.map(o=>o.value));assert.equal(options.length,11);
 for(const theme of options.filter(t=>t!=='custom')){await page.locator('#frame-theme').selectOption(theme);await page.waitForFunction(t=>document.querySelector('.viewer-host').dataset.frameTheme===t,theme);}
 const select=await page.locator('#frame-theme').boundingBox(),preview=await page.locator('.theme-preview').boundingBox();assert.ok(preview.x>=select.x+select.width);
 await page.locator('#frame-theme').selectOption('custom');await page.locator('#custom-frame').fill('#3366aa');await page.locator('#custom-background-style').selectOption('grid');await page.locator('#custom-background').fill('#112233');await page.locator('#custom-secondary').fill('#aabbcc');
 await page.waitForFunction(()=>document.querySelector('.viewer-host').dataset.frameColor==='#3366aa'&&document.querySelector('.viewer-host').dataset.backgroundStyle==='grid');await sameHeight();
 await page.locator('#frame-theme').selectOption('oak');await page.locator('#frame-theme').selectOption('custom');assert.equal(await page.locator('#custom-frame').inputValue(),'#3366aa');assert.equal(await page.locator('#custom-background-style').inputValue(),'grid');
 await page.locator('#custom-background-style').selectOption('image');const uploaded=page.waitForResponse(r=>r.url().endsWith(`/api/cards/${id}/background`));
 await page.locator('.custom-theme input[type=file]').setInputFiles(path.join(parent,'sample-03/source.png'));assert.equal((await uploaded).status(),200);await page.waitForFunction(()=>document.querySelector('.viewer-host').dataset.backgroundReady==='true');
 const saveSettings=page.waitForResponse(r=>r.url().endsWith(`/api/cards/${id}/settings`)&&r.request().method()==='PATCH');await page.getByRole('button',{name:'액자 설정 저장',exact:true}).click();assert.equal((await saveSettings).status(),200);
 await page.reload();await pick();assert.equal(await page.locator('#frame-theme').inputValue(),'custom');assert.equal(await page.locator('#custom-frame').inputValue(),'#3366aa');assert.equal(await page.locator('#custom-background-style').inputValue(),'image');await page.waitForFunction(()=>document.querySelector('.viewer-host').dataset.backgroundReady==='true');
 // Boundary brush: true pixels change, alpha erase/restore, undo/redo, sample, pan and zoom.
 await page.getByRole('button',{name:'경계 수정',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.editor footer .primary')?.disabled);await page.waitForFunction(()=>document.querySelector('.viewer-host').dataset.paused==='true');
 await page.getByRole('button',{name:'마스크',exact:true}).click();await page.locator('#brush-size').fill('38');
 const centerBefore=await pixel(300,320);assert.equal(centerBefore[3],255);
 await page.locator('.paint-viewport').focus();await page.keyboard.press('KeyE');assert.equal(await page.getByRole('button',{name:'지우개 (E)',exact:true}).getAttribute('aria-pressed'),'true');
 await stroke([290,320],[330,320]);assert.equal((await pixel(300,320))[3],0);const p=await canvasPoint(320,310);await page.mouse.move(p.x,p.y);
 assert.equal(await page.locator('.paint-brush-cursor').evaluate(c=>getComputedStyle(c).display),'block');assert.ok((await page.locator('.paint-brush-cursor').boundingBox()).width>10);
 await page.keyboard.press('Control+KeyZ');await page.waitForTimeout(80);assert.deepEqual(await pixel(300,320),centerBefore);await page.keyboard.press('Control+Shift+KeyZ');await page.waitForTimeout(80);assert.equal((await pixel(300,320))[3],0);
 await page.keyboard.press('KeyR');await clickPixel(300,320);assert.equal((await pixel(300,320))[3],255);
 // Pick a different palette layer so a color change cannot be mistaken for an unchanged pixel.
 const oldCount=await page.locator('.paint-palette button').count();
 await page.getByRole('button',{name:'레이어 추가',exact:true}).click();await page.locator('#new-layer-name').fill('New painted layer');await page.locator('#new-layer-color').fill('#45b6c4');await page.getByRole('button',{name:'추가',exact:true}).click();
 const palette=page.locator('.paint-palette button');assert.equal(await palette.count(),oldCount+1);assert.equal(await palette.last().getAttribute('aria-pressed'),'true');
 await page.locator('.paint-viewport').focus();await page.keyboard.press('KeyB');await clickPixel(300,320);const painted=await pixel(300,320);assert.deepEqual(painted,[69,182,196,255]);
 await page.keyboard.press('Control+KeyZ');await page.waitForTimeout(80);assert.notDeepEqual(await pixel(300,320),painted);await page.keyboard.press('Control+Shift+KeyZ');await page.waitForTimeout(80);assert.deepEqual(await pixel(300,320),painted);
 await palette.first().click();await page.locator('.paint-viewport').focus();await page.keyboard.press('KeyI');await clickPixel(300,320);assert.equal(await palette.last().getAttribute('aria-pressed'),'true');
 await page.keyboard.press('KeyB');await page.keyboard.press('BracketRight');assert.equal(await page.locator('#brush-size').inputValue(),'45');await page.keyboard.press('BracketLeft');assert.equal(await page.locator('#brush-size').inputValue(),'38');
 await page.keyboard.press('Digit1');assert.equal(await page.locator('.paint-zoom output').innerText(),'100%');
 const panBefore=await page.locator('.paint-image').getAttribute('style'),vp=await page.locator('.paint-viewport').boundingBox();await page.keyboard.down('Space');await page.mouse.move(vp.x+vp.width/2,vp.y+vp.height/2);await page.mouse.down();await page.mouse.move(vp.x+vp.width/2+50,vp.y+vp.height/2+20,{steps:5});await page.mouse.up();await page.keyboard.up('Space');assert.notEqual(await page.locator('.paint-image').getAttribute('style'),panBefore);
 await page.keyboard.press('Digit0');const zoomBefore=await page.locator('.paint-zoom output').innerText();await page.mouse.wheel(0,-200);await page.waitForTimeout(150);assert.notEqual(await page.locator('.paint-zoom output').innerText(),zoomBefore);await page.keyboard.press('Digit0');
 await page.getByRole('button',{name:'겹쳐 보기',exact:true}).click();const cursorPoint=await canvasPoint(300,320);await page.mouse.move(cursorPoint.x,cursorPoint.y);await page.screenshot({path:path.join(out,'paint-editor-light.png')});
 await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await page.waitForTimeout(250);console.log('Dark editor colors:',await page.locator('.paint-editor').evaluate(el=>({text:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor,button:getComputedStyle(el.querySelector('.paint-tools button:not(.active)')).color})));await page.screenshot({path:path.join(out,'paint-editor-dark.png')});await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 // Shortcuts do not hijack controls, and saved categorical masks reload without changes.
 await page.locator('#brush-size').focus();await page.keyboard.press('KeyE');assert.equal(await page.getByRole('button',{name:'브러시 (B)',exact:true}).getAttribute('aria-pressed'),'true');
 const saved=page.waitForResponse(r=>r.url().endsWith(`/api/cards/${id}/masks`)&&r.request().method()==='POST');await page.locator('.paint-viewport').focus();await page.keyboard.press('Control+KeyS');assert.equal((await saved).status(),200);await page.locator('.paint-editor').waitFor({state:'hidden'});await page.locator('.stage-loading').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'경계 수정',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.editor footer .primary')?.disabled);await page.getByRole('button',{name:'마스크',exact:true}).click();await page.waitForTimeout(100);assert.deepEqual(await pixel(300,320),painted);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const dialog=await page.locator('.paint-editor').boundingBox();assert.ok(dialog.x>=0&&dialog.x+dialog.width<=390);await page.screenshot({path:path.join(out,'paint-editor-mobile.png')});
 await page.getByRole('button',{name:'편집 닫기',exact:true}).click();await sameHeight();await collection();await sameCards();await page.screenshot({path:path.join(out,'collection-mobile.png'),fullPage:true});
 await page.setViewportSize({width:768,height:1024});await sameCards();await pick();await sameHeight();
 assert.deepEqual(errors,[]);const after=await (await fetch(base+'/api/cards')).json();for(const card of original)assert.deepEqual(after.find(c=>c.id===card.id),card);
 console.log('PASS: uniform gallery cards and top import; equal panel heights desktop/tablet/mobile; ten themes and right preview; custom colors/image persisted; paused WebGL; brush/erase/restore/eyedropper; exact undo/redo and saved mask pixels; shortcuts; pan/zoom; light/dark/mobile; existing library untouched.');
}finally{await browser.close();if(path.dirname(folder)!==parent||!id.startsWith('test-'))throw Error('Invalid cleanup');await fs.rm(folder,{recursive:true,force:true});}
