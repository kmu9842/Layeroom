// Compose captions and callouts around untouched screenshots using HTML/CSS.
// No UI mockups, generated artwork, or edits to the source screenshots.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),dir=path.join(root,'docs/guide');
const scenes=JSON.parse(await fs.readFile(path.join(dir,'scenes.json'),'utf8'));
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const css=`*{box-sizing:border-box}body{margin:0;font-family:'Malgun Gothic','Segoe UI',sans-serif;background:#e5e9e7;color:#243930}.sheet{position:relative;width:2240px;height:1520px;overflow:hidden;background:#f5f6f1;padding:52px 60px;display:none}.sheet.active{display:block}.mast{display:flex;align-items:center;justify-content:space-between;font-size:23px;letter-spacing:1px;color:#627067}.wordmark{font-size:32px;letter-spacing:-1px;font-weight:750;color:#2e453a}.heading{display:flex;align-items:baseline;gap:22px;margin-top:34px}.step{font:600 55px 'Segoe UI';color:#9aae9e}h1{font-size:51px;letter-spacing:-2px;margin:0;font-weight:700}.subtitle{font-size:25px;margin:14px 0 0;color:#607068}.body{position:absolute;left:60px;right:60px;top:247px;bottom:82px;display:grid;grid-template-columns:1540px 1fr;gap:46px}.screen{position:relative;width:1540px;align-self:start;box-shadow:0 16px 45px #18372617;border:1px solid #ccd5cc;background:#fff;overflow:hidden;border-radius:10px}.screen>img{width:100%;display:block}.mark{position:absolute;border:3px solid #27715b;border-radius:6px;box-shadow:0 0 0 2px #fff9;pointer-events:none}.mark b{position:absolute;left:-2px;top:-2px;display:grid;place-items:center;width:36px;height:36px;background:#246b55;border:2px solid white;border-radius:50%;font:700 20px 'Segoe UI';color:white;transform:translate(-30%,-30%);box-shadow:0 2px 7px #162e3338}.notes{display:flex;flex-direction:column;gap:36px;padding-top:7px}.note-title{font-size:29px;letter-spacing:-1px;font-weight:700;display:flex;align-items:center;gap:12px}.note-title span{width:33px;height:33px;display:grid;place-items:center;flex-shrink:0;background:#dbe6db;color:#356247;border-radius:50%;font:700 20px 'Segoe UI'}.note p{font-size:24px;line-height:1.72;letter-spacing:-.4px;margin:13px 0 0 45px;word-break:keep-all;overflow-wrap:break-word;color:#53635a}.bottom{position:absolute;left:60px;right:60px;bottom:30px;display:flex;justify-content:space-between;font-size:19px;color:#778378}.widget-pair{display:flex;align-items:flex-start;justify-content:space-evenly;gap:40px;padding:40px 20px;background:linear-gradient(140deg,#dbe6df,#ccd7d3);border-radius:12px;min-height:1100px}.widget-pair figure{margin:0;text-align:center}.widget-pair img{width:650px;height:auto;display:block;filter:drop-shadow(0 15px 20px #273e3022)}figcaption{font-size:26px;font-weight:600;color:#365643;margin:20px 0 30px}.widget .notes{gap:22px}.widget .note p{font-size:23px;line-height:1.58}.widget .note-title{font-size:27px}`;
function sheet(scene,i){
 const screen=scene.widget?`<div class="widget-pair"><figure><figcaption>실행한 위젯</figcaption><img src="screenshots/08-widget.png" alt="실행 중인 Layeroom 위젯"/></figure><figure><figcaption>톱니바퀴 → 위젯 설정</figcaption><img src="screenshots/08-widget-settings.png" alt="실제 위젯 설정 화면"/></figure></div>`:
 `<div class="screen"><img src="screenshots/${scene.id}.png" alt="${escape(scene.title)} 실제 화면"/>${scene.boxes.map(b=>`<div class="mark" style="left:${b.x/scene.width*100}%;top:${b.y/scene.height*100}%;width:${b.width/scene.width*100}%;height:${b.height/scene.height*100}%"><b>${b.n}</b></div>`).join('')}</div>`;
 return `<article id="${scene.id}" class="sheet ${scene.widget?'widget':scene.native?'native':''}"><div class="mast"><span class="wordmark">Layeroom</span><span>WINDOWS PORTABLE · 사용 가이드</span></div><div class="heading"><span class="step">${String(i+1).padStart(2,'0')}</span><h1>${escape(scene.title)}</h1></div><p class="subtitle">${escape(scene.subtitle)}</p><div class="body">${screen}<aside class="notes">${scene.notes.map(([title,body],n)=>`<section class="note"><div class="note-title"><span>${n+1}</span>${escape(title)}</div><p>${escape(body)}</p></section>`).join('')}</aside></div><footer class="bottom"><span>Layeroom 실제 프로그램 화면 · PNG 사용 가이드</span><span>${i+1} / ${scenes.length}</span></footer></article>`;
}
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>Layeroom 가이드 이미지</title><style>${css}.native .screen{width:1050px;justify-self:center}.native .notes{gap:22px}.native .note p{font-size:23px;line-height:1.6}</style><body>${scenes.map(sheet).join('')}<script>document.querySelector('.sheet').classList.add('active')</script></body></html>`;
await fs.writeFile(path.join(dir,'pages.html'),html);
await fs.mkdir(path.join(dir,'images'),{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:2240,height:1520},deviceScaleFactor:1});
 await page.goto(pathToFileURL(path.join(dir,'pages.html')).href);
 await page.evaluate(()=>document.fonts.ready);
 for(const scene of scenes){
  await page.evaluate(id=>{document.querySelectorAll('.sheet').forEach(el=>el.classList.toggle('active',el.id===id));},scene.id);
  await page.locator(`[id="${scene.id}"] img`).evaluateAll(images=>Promise.all(images.map(img=>img.decode())));
  const overflow=await page.locator(`[id="${scene.id}"] .notes`).evaluate(el=>el.scrollHeight>el.clientHeight+1);
  if(overflow)throw Error('Guide notes overflow: '+scene.id);
  await page.screenshot({path:path.join(dir,'images',scene.id+'.png')});
  console.log('Guide PNG: '+scene.id);
 }
}finally{await browser.close();await fs.rm(path.join(dir,'pages.html'),{force:true});}
console.log('Created '+scenes.length+' final PNG guides');
