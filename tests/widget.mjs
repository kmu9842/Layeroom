import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import net from 'node:net';

const root=process.cwd(),base='http://127.0.0.1:8765',output=path.resolve('test-results'),python=path.join(root,'.venv/Scripts/python.exe');
await fs.mkdir(output,{recursive:true});
const original=await (await fetch(base+'/api/cards')).json(),card=original.find(c=>c.id==='sample-01');
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1120},colorScheme:'light'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const executable=path.join(output,'downloaded-widget.exe');
let native,nativePage,serverStopped=false;
const cursorCode="import ctypes,json;from ctypes import wintypes;p=wintypes.POINT();ctypes.windll.user32.GetCursorPos(ctypes.byref(p));print(json.dumps([p.x,p.y]))";
const oldCursor=JSON.parse(execFileSync(python,['-c',cursorCode],{encoding:'utf8'}));
function moveCursor(x,y){execFileSync(python,['-c',`import ctypes;ctypes.windll.user32.SetCursorPos(${Math.round(x)},${Math.round(y)})`]);}
async function freePort(){return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});}
async function launch(){
 const port=await freePort();const child=spawn(executable,[],{cwd:output,windowsHide:true,stdio:'ignore',env:{...process.env,LAYEROOM_WIDGET_TEST_PORT:String(port)}});child.on('error',e=>errors.push(e.message));child.unref();
 const start=Date.now();let endpoint;
 while(Date.now()-start<60000){try{endpoint=await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();break;}catch{await new Promise(r=>setTimeout(r,200));}}
 assert.ok(endpoint,'Portable EXE must start an independent Electron process');
 native=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);const context=native.contexts()[0];nativePage=context.pages()[0]||await context.waitForEvent('page');
 nativePage.on('pageerror',e=>errors.push(e.message));await nativePage.waitForURL('widget://app/index.html');await nativePage.waitForSelector('.widget-shell[data-ready=true]',{timeout:30000});await nativePage.waitForFunction(()=>document.querySelector('.viewer-host')?.dataset.layerOrder);return nativePage;
}
async function closeNative(){if(nativePage&&!nativePage.isClosed()){await nativePage.evaluate(()=>window.widget.close()).catch(()=>{});await nativePage.waitForEvent('close',{timeout:5000}).catch(()=>{});}await native?.close().catch(()=>{});native=null;nativePage=null;}
async function setNativeCheck(id,value){const input=nativePage.locator(id);if(await input.isChecked()!==value)await input.click();await nativePage.waitForFunction(([selector,checked])=>document.querySelector(selector).checked===checked,[id,value]);}
try{
 await page.goto(base);await page.locator('.gallery-card[data-card-id="sample-01"]').click();await page.locator('.stage-loading').waitFor({state:'hidden'});
 const save=await page.getByRole('button',{name:'액자 설정 저장',exact:true}).boundingBox(),download=await page.getByRole('button',{name:'위젯으로 받기',exact:true}).boundingBox();assert.ok(download.x>save.x+save.width&&Math.abs(download.y-save.y)<1);
 // Intentionally do not press Save: the EXE must reflect the live settings.
 await page.locator('#layer-gap').fill('0.09');await page.locator('#frame-theme').selectOption('navy');await page.locator('#breathing-toggle').uncheck();
 const expectedOrder=card.settings.layer_order;const hidden=card.layers[0];await page.getByRole('button',{name:`${hidden.name} 숨기기`,exact:true}).click();
 const event=page.waitForEvent('download',{timeout:60000});await page.getByRole('button',{name:'위젯으로 받기',exact:true}).click();const file=await event;assert.ok(file.suggestedFilename().endsWith('.exe'));await file.saveAs(executable);assert.equal((await fs.readFile(executable)).subarray(0,2).toString(),'MZ');
 await page.screenshot({path:path.join(output,'widget-download-button.png'),fullPage:true});
 const extract="import io,json,struct,sys,zipfile;d=open(sys.argv[1],'rb').read();magic=b'LAYEROOMWIDGET1';tail=8+len(magic);n=struct.unpack('<Q',d[-tail:-len(magic)])[0];z=zipfile.ZipFile(io.BytesIO(d[-tail-n:-tail]));print(z.read('snapshot.json').decode())";
 const snapshot=JSON.parse(execFileSync(python,['-X','utf8','-c',extract,executable],{encoding:'utf8'}));assert.equal(snapshot.card.settings.layer_gap,.09);assert.equal(snapshot.card.settings.frame_theme,'navy');assert.deepEqual(snapshot.card.settings.layer_order,expectedOrder);assert.ok(snapshot.card.settings.hidden_layers.includes(hidden.id));assert.equal(snapshot.card.settings.breathing,false);
 assert.deepEqual(await (await fetch(base+'/api/cards')).json(),original,'Downloading must not change saved settings or images');
 await browser.close();
 // Stop the actual web server before launching the downloaded EXE.
 execFileSync(python,['scripts/launch.py','--stop'],{cwd:root});serverStopped=true;
 let unavailable=false;try{await fetch(base+'/api/health');}catch{unavailable=true;}assert.ok(unavailable,'Studio server must be off during the portable test');
 await launch();const state=await nativePage.evaluate(()=>window.widget.initialize());assert.deepEqual(state.snapshot,snapshot);
 assert.equal(await nativePage.locator('.viewer-host').getAttribute('data-layer-order'),expectedOrder.join(','));assert.equal(await nativePage.locator('.viewer-host').getAttribute('data-frame-theme'),'navy');assert.equal(await nativePage.locator('.viewer-host').getAttribute('data-breathing'),'false');assert.ok(Number(await nativePage.locator('.viewer-host').getAttribute('data-frame-depth'))>.5);
 assert.equal(await nativePage.evaluate(()=>typeof window.require),'undefined');assert.equal(await nativePage.evaluate(()=>typeof window.process),'undefined');
 assert.equal(await nativePage.evaluate(async()=>{try{await window.widget.configure({layer_gap:.45});return false;}catch{return true;}}),true);
 const firstBounds=await nativePage.evaluate(()=>({x:screenX,y:screenY,width:outerWidth,height:outerHeight}));assert.equal(firstBounds.width,320);assert.equal(firstBounds.height,420);
 const mouse=await nativePage.evaluate(()=>({width:screen.width,height:screen.height}));moveCursor(25,25);await nativePage.waitForTimeout(550);const left=Number(await nativePage.locator('.viewer-host').getAttribute('data-rotation-y'));moveCursor(mouse.width-25,mouse.height-25);await nativePage.waitForTimeout(550);const right=Number(await nativePage.locator('.viewer-host').getAttribute('data-rotation-y'));assert.ok(Math.abs(right-left)>.08,'Global cursor outside widget must change rotation');
 await nativePage.getByRole('button',{name:'위젯 설정',exact:true}).click();await setNativeCheck('#widget-follow',false);await setNativeCheck('#widget-auto',true);
 const r1=Number(await nativePage.locator('.viewer-host').getAttribute('data-rotation-y'));await nativePage.waitForTimeout(500);const r2=Number(await nativePage.locator('.viewer-host').getAttribute('data-rotation-y'));assert.ok(Math.abs(r2-r1)>.015,'Auto rotation must change angle');
 await nativePage.locator('#widget-size').selectOption('large');await nativePage.waitForFunction(()=>outerWidth===440&&outerHeight===570);const large=await nativePage.evaluate(()=>({x:screenX,y:screenY,width:outerWidth,height:outerHeight}));assert.equal(large.x+large.width,firstBounds.x+firstBounds.width);assert.equal(large.y+large.height,firstBounds.y+firstBounds.height);
 await nativePage.screenshot({path:path.join(output,'widget-settings.png'),omitBackground:true});
 await setNativeCheck('#widget-auto',false);await nativePage.getByRole('button',{name:'설정 닫기',exact:true}).click();
 // Rotation eases to rest; low frame rates make a fixed 1.5 s timeout unreliable.
 let previousAngle=NaN,stableSamples=0;for(let i=0;i<40&&stableSamples<3;i++){await nativePage.waitForTimeout(350);const angle=Number(await nativePage.locator('.viewer-host').getAttribute('data-rotation-y'));stableSamples=Math.abs(angle-previousAngle)<1e-7?stableSamples+1:0;previousAngle=angle;}assert.ok(stableSamples>=3,'Rotation must settle after disabling both rotation options');
 const still1=Number(await nativePage.locator('.viewer-host').getAttribute('data-rotation-y'));await nativePage.waitForTimeout(350);const still2=Number(await nativePage.locator('.viewer-host').getAttribute('data-rotation-y'));assert.ok(Math.abs(still2-still1)<1e-7,'Fixed rotation must settle without visible angular drift');assert.equal(await nativePage.locator('.viewer-host').getAttribute('data-inertia'),'0');
 await nativePage.screenshot({path:path.join(output,'widget-transparent.png'),omitBackground:true});
 const boundsBeforeClose=await nativePage.evaluate(()=>({x:screenX,y:screenY}));await closeNative();await launch();const reopened=await nativePage.evaluate(()=>window.widget.initialize());assert.deepEqual(reopened.options,{autoRotate:false,followMouse:false,size:'large'});assert.deepEqual(reopened.snapshot,snapshot);assert.deepEqual(await nativePage.evaluate(()=>({x:screenX,y:screenY})),boundsBeforeClose);
 await nativePage.getByRole('button',{name:'위젯 설정',exact:true}).click();await nativePage.locator('#widget-size').selectOption('small');await nativePage.waitForFunction(()=>outerWidth===240&&outerHeight===320);assert.ok(await nativePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await nativePage.screenshot({path:path.join(output,'widget-small.png'),omitBackground:true});
 assert.deepEqual(errors,[]);console.log(`PASS: live unsaved settings export, executable download (${((await fs.stat(executable)).size/1024/1024).toFixed(1)} MB), server OFF launch, exact frozen layers/theme/motion, global mouse following, auto rotation, fixed mode, three sizes, settings/position persistence, isolated renderer, protected artwork settings.`);
}finally{
 await closeNative();await browser.close().catch(()=>{});moveCursor(...oldCursor);
 if(serverStopped)execFileSync(python,['scripts/launch.py','--no-browser'],{cwd:root});
}
