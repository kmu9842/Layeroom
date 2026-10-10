import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1120}});
try{
 await page.goto('http://127.0.0.1:8765');
 await page.locator('.gallery-card[data-card-id="sample-01"]').click();
 await page.locator('.stage-loading').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'경계 수정',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.editor footer .primary')?.disabled);
 const canvas=page.locator('.edit-canvas-wrap canvas, .paint-canvas').first(),box=await canvas.boundingBox();
 await page.mouse.move(box.x+box.width*.45,box.y+box.height*.5);await page.mouse.down();
 const result=await page.evaluate(async()=>{
  const target=document.querySelector('.paint-viewport')||document.querySelector('.edit-canvas-wrap canvas'),canvas=document.querySelector('.editor canvas'),r=canvas.getBoundingClientRect(),times=[],renders=[],pixels=[];
  for(let i=0;i<16;i++){
   const start=performance.now();target.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,pointerType:'mouse',buttons:1,clientX:r.x+r.width*.45+i*2,clientY:r.y+r.height*.5+i}));
   times.push(performance.now()-start);await new Promise(requestAnimationFrame);renders.push(Number(canvas.dataset.paintMs||0));pixels.push(Number(canvas.dataset.dirtyPixels||0));
  }
  return {dispatch_ms:times,render_ms:renders,dirty_pixels:pixels,mean:times.reduce((a,b)=>a+b,0)/times.length,max:Math.max(...times),width:canvas.width,height:canvas.height};
 });
 await page.mouse.up();console.log(JSON.stringify(result));
 await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/editor-${process.argv[2]||'benchmark'}.json`,JSON.stringify(result,null,2));
}finally{await browser.close();}
