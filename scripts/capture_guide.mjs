import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import net from 'node:net';

const root=process.cwd(),release=process.env.LAYEROOM_GUIDE_APP;
assert.ok(release,'Set LAYEROOM_GUIDE_APP to the isolated capture application');
const {url:base}=JSON.parse((await fs.readFile(path.join(release,'_internal/data/runtime.json'),'utf8')).replace(/^\uFEFF/,''));
const out=path.join(root,'docs/guide'),raw=path.join(out,'screenshots');
await fs.mkdir(raw,{recursive:true});await fs.mkdir(path.join(root,'test-results'),{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1120},deviceScaleFactor:2,colorScheme:'light'});
const page=await context.newPage(),errors=[],scenes=[];
page.on('pageerror',error=>errors.push(error.message));
await context.route('**/*',route=>route.request().url().startsWith(base)||route.request().url().startsWith('data:')?route.continue():route.abort());
const original=await (await fetch(base+'/api/cards')).json();
assert.equal(original.length,0,'Distribution starts empty and must contain approved character artwork in guide screenshots');
const demoId='guide-character',demoFolder=path.join(release,'_internal/data/cards',demoId);
let fixtureCreated=false;
async function createCharacter(){
 await fs.cp(path.join(root,'test-results/character-capture/cards/guide-character'),demoFolder,{recursive:true});
 fixtureCreated=true;
}
async function choose(id){await page.goto(base);await page.locator(`.gallery-card[data-card-id="${id}"]`).click();await page.locator('.stage-loading').waitFor({state:'hidden'});await page.waitForTimeout(500);}
async function shot(id,title,subtitle,notes,targets=[],extra={}){
 const boxes=[];
 for(let i=0;i<targets.length;i++){
  const box=await page.locator(targets[i]).first().boundingBox();
  if(box)boxes.push({...box,n:i+1});
 }
 const dimensions=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
 await page.screenshot({path:path.join(raw,id+'.png')});
 scenes.push({id,title,subtitle,notes,boxes,...dimensions,...extra});
 console.log('Captured '+id);
}
let native,nativePage;
try {
 await createCharacter();
 await page.goto(base);await page.getByRole('button',{name:'이미지 추가',exact:true}).waitFor();await page.waitForTimeout(500);
 assert.match(await page.title(),/Layeroom/);
 assert.equal(await page.getByRole('button',{name:/리서치|분절 방식과 한계/}).count(),0);
 await shot('01-start','실행과 컬렉션','ZIP 전체를 풀고 Layeroom.exe를 실행합니다.',[
  ['이미지 추가','상단의 이미지 추가를 눌러 새 작품을 가져옵니다. 파일을 이 영역으로 끌어놓아도 됩니다.'],
  ['작품 열기','추가한 캐릭터를 누르면 스튜디오가 열립니다. 이 화면은 안내용 캐릭터를 직접 가져온 상태이며, 배포판 컬렉션은 비어 있습니다.'],
  ['종료와 이동','브라우저를 닫아도 서버는 유지됩니다. 트레이 → 종료로 끝낸 뒤 Layeroom 폴더 전체를 옮기세요.']
 ],['.gallery-import']);
 await page.getByRole('button',{name:'이미지 추가',exact:true}).click();
 await shot('02-import','이미지·PSD 가져오기','일반 이미지는 자동 분절, PSD는 원본 레이어로 가져옵니다.',[
  ['파일 선택','점선 영역을 누르거나 파일을 끌어놓습니다. PNG·JPG·WebP는 20MB, PSD는 100MB까지 지원합니다.'],
  ['PSD 순서 유지','PSD는 AI 분절을 생략합니다. 원본 레이어 순서·위치·투명도·표시 상태를 가져옵니다.'],
  ['처리 완료 후 확인','일반 이미지의 자동 분절은 결과를 확인하세요. 필요한 부분은 경계 수정에서 직접 보정할 수 있습니다.']
 ],['.dropzone']);
 await page.getByRole('button',{name:'가져오기 닫기'}).click();
 await choose(demoId);
 await page.getByRole('button',{name:'액자 이름 수정'}).click();
 await shot('03-frame','이름·깊이·회전 설정','변경한 설정은 미리보기에 바로 반영됩니다.',[
  ['이름 바로 수정','액자 아래 이름을 클릭해 입력합니다. Enter로 확정하고 Esc로 취소합니다.'],
  ['깊이와 보조층','Z축 간격은 0–0.1, 기본 0.025, 변경 단위 0.005입니다. 종이 보조층을 켜면 조각 아래를 적층 단면으로 채웁니다.'],
  ['회전과 저장','마우스 이동·드래그로 각도를 살펴보고 회전 한도를 조절하세요. 액자 설정 저장으로 변경값을 보관합니다.']
 ],['.inline-frame-title','.inspector-scroll .panel-section:first-child','.save-button']);
 await page.keyboard.press('Escape');
 await choose(demoId);
 await page.locator('#frame-theme').selectOption('custom');
 await page.locator('#custom-frame').fill('#29474f');
 await page.locator('#custom-background-style').selectOption('gradient');
 await page.locator('#custom-background').fill('#eef2e8');
 await page.locator('#custom-secondary').fill('#9db7bf');
 await page.locator('.appearance-section').evaluate(el=>el.parentElement.scrollTop=el.offsetTop-el.parentElement.offsetTop-20);
 await page.mouse.move(500,500);await page.waitForTimeout(700);
 await shot('04-theme','액자 테마·커스텀 배경','테마를 고르면 드롭다운 오른쪽에 미리보기가 표시됩니다.',[
  ['테마 선택','드롭다운에서 준비된 테마를 선택합니다. 직접 꾸미려면 커스텀을 선택하세요.'],
  ['색상과 배경','액자 색상과 배경 색상을 지정합니다. 단색·그라데이션·패브릭·격자·이미지를 사용할 수 있습니다.'],
  ['배경 이미지','배경을 이미지로 바꾸면 파일 선택 버튼이 나타납니다. 마지막에 액자 설정 저장을 누르세요.']
 ],['.theme-picker','.custom-theme']);
 await choose(demoId);
 await page.locator('.layer-z-toggle').first().click();
 await page.locator('.layer-position-control input[type=range]').fill('15');
 await page.locator('.layer-position-control input[type=range]').press('Tab');
 await page.locator('.inspector-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
 await page.mouse.move(620,520);await page.waitForTimeout(800);
 await shot('05-layers','레이어 Z 위치·순서','레이어 행의 Z 버튼으로 개별 깊이를 지정합니다.',[
  ['개별 Z 위치','슬라이더 또는 숫자를 입력합니다. 앞면 0% ↔ 뒷면 100%이며, 조절을 마치면 목록도 앞뒤 위치에 맞춰 정렬됩니다.'],
  ['순서 변경','레이어의 손잡이·이름 영역을 잡고 위아래로 드래그합니다. 키보드는 Space → 방향키 → Space로 이동합니다.'],
  ['균등 배치·원본 복원','Z 위치 균등 배치는 현재 순서를 유지하며 간격을 맞춥니다. 원본 순서 복원은 순서와 개별 Z 위치를 초기화합니다.'],
  ['고정 / 움직임','기본은 고정입니다. 레이어 움직임을 켠 뒤 각 행의 체크로 움직일 부위를 지정하세요. 눈 아이콘은 표시 여부를 바꿉니다.']
 ],['.layer-position-control','.layer-row:nth-child(2) .layer-drag-handle','.layer-footnote','.layer-motion-check']);
 await choose(demoId);await page.getByRole('button',{name:'경계 수정',exact:true}).click();
 await page.locator('.paint-loading').waitFor({state:'hidden'});
 const palette=page.locator('.paint-palette button');
 await palette.filter({hasText:'얼굴'}).first().click();
 await page.locator('#brush-size').fill('48');await page.locator('#mask-opacity').fill('0.45');
 const paint=await page.locator('.paint-viewport').boundingBox();await page.mouse.move(paint.x+paint.width*.52,paint.y+paint.height*.35);
 await page.getByRole('button',{name:'레이어 추가',exact:true}).click();await page.locator('#new-layer-name').fill('날개');
 await shot('06-paint','경계 수정·레이어 추가','레이어를 선택하거나 새로 만든 뒤 해당 영역을 칠합니다.',[
  ['도구 선택','B 브러시 · E 지우개 · R 복원 · I 부위 선택 · H 이동. Alt+클릭으로 부위를 추출할 수도 있습니다.'],
  ['레이어 추가','레이어 추가 → 이름·표시 색상 → 추가를 누릅니다. 새 레이어를 선택하고 브러시로 영역을 칠하세요. [ / ]로 붓 크기를 바꿉니다.'],
  ['이동·실행 취소·저장','Space+드래그 이동, 휠 확대, 0 맞춤, 1 실제 크기. Ctrl+Z 취소 / Ctrl+Shift+Z 다시 실행. 수정 적용 또는 Ctrl+S로 저장합니다.']
 ],['.paint-tools','.paint-add-form','.paint-editor footer .primary']);
 await page.getByRole('button',{name:'편집 닫기'}).click();
 await choose(demoId);await page.mouse.move(550,490);await page.waitForTimeout(650);
 await shot('07-export','저장·PNG·레이어·위젯 출력','용도에 맞는 출력 방식을 선택합니다.',[
  ['설정 저장','현재 작품의 액자 설정을 이 PC에 저장합니다. 나중에 컬렉션에서 다시 열면 같은 설정을 불러옵니다.'],
  ['위젯으로 받기','현재 설정과 작품을 포함한 EXE를 만듭니다. 아직 저장하지 않은 변경값도 반영됩니다.'],
  ['PNG / 레이어 ZIP','액자 PNG는 현재 보이는 액자 이미지입니다. 레이어 ZIP에는 부위 PNG·마스크·깊이·메타데이터가 들어갑니다.']
 ],['.save-button','.widget-download','.export-row']);
 const wait=page.waitForEvent('download',{timeout:120000});await page.getByRole('button',{name:'위젯으로 받기',exact:true}).click();
 const downloaded=await wait,exe=path.join(root,'test-results/Layeroom-widget-guide.exe');await downloaded.saveAs(exe);
 assert.equal((await fs.readFile(exe)).subarray(0,2).toString(),'MZ');
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const child=spawn(exe,[],{windowsHide:true,stdio:'ignore',env:{...process.env,LAYEROOM_WIDGET_TEST_PORT:String(port)}});child.unref();
 let endpoint;for(let i=0;i<300;i++){try{endpoint=await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();break;}catch{await new Promise(r=>setTimeout(r,200));}}
 assert.ok(endpoint,'Downloaded widget EXE must start');
 native=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);nativePage=native.contexts()[0].pages()[0];
 nativePage.on('pageerror',error=>errors.push(error.message));
 await nativePage.waitForSelector('.widget-shell[data-ready=true]',{timeout:60000});
 await nativePage.getByRole('button',{name:'위젯 설정',exact:true}).click();
 await nativePage.locator('#widget-size').selectOption('large');
 await nativePage.locator('#widget-follow').uncheck();await nativePage.locator('#widget-auto').uncheck();
 await nativePage.getByRole('button',{name:'설정 닫기'}).click();await nativePage.waitForTimeout(900);
 await nativePage.screenshot({path:path.join(raw,'08-widget.png'),omitBackground:true});
 await nativePage.getByRole('button',{name:'위젯 설정',exact:true}).click();
 await nativePage.screenshot({path:path.join(raw,'08-widget-settings.png'),omitBackground:true});
 scenes.push({id:'08-widget',title:'바탕화면 위젯 사용',subtitle:'받은 EXE를 실행하면 모니터 한쪽에 액자가 나타납니다.',widget:true,notes:[
  ['위치 이동','액자나 위쪽 손잡이를 드래그해 원하는 위치로 옮깁니다. 톱니바퀴 버튼으로 설정을 엽니다.'],
  ['세 가지 위젯 설정','자동 회전, 마우스 따라 회전, 크기를 바꿀 수 있습니다. 회전 옵션을 모두 끄면 각도가 고정됩니다.'],
  ['다운로드 시점의 액자','레이어 순서·표시·움직임·보조층·색상·배경은 받을 당시 값으로 유지됩니다. 바꾸려면 스튜디오에서 수정한 뒤 다시 받으세요.'],
  ['독립 실행과 종료','Layeroom을 종료해도 위젯은 동작합니다. X 또는 트레이 메뉴로 종료합니다. 위치와 위젯 설정은 다음 실행에도 유지됩니다.']
 ]});
 assert.deepEqual((await (await fetch(base+'/api/cards')).json()).map(c=>c.id),[demoId]);
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'scenes.json'),JSON.stringify(scenes,null,2));
 await fs.writeFile(path.join(root,'test-results/guide-capture.json'),JSON.stringify({application:'Layeroom',actualPortableUI:true,initialCollectionEmpty:true,userArtworkIncluded:true,guideArtwork:'user-supplied character, local automatic segmentation',pages:scenes.length,widgetExecutable:true,errors},null,2));
 console.log('PASS: real portable UI + real widget EXE, eight guide scenes; approved character artwork in guide screenshots');
}finally{
 if(nativePage&&!nativePage.isClosed())await nativePage.evaluate(()=>window.widget.close()).catch(()=>{});
 await native?.close().catch(()=>{});await browser.close();
 if(fixtureCreated){
  assert.equal(path.resolve(demoFolder),path.resolve(release,'_internal/data/cards/guide-character'));
  await fs.rm(demoFolder,{recursive:true,force:true});
  assert.deepEqual(await (await fetch(base+'/api/cards')).json(),original,'Guide fixture must not remain in distribution');
 }
}
