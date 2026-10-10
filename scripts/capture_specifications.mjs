import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),dir=path.join(root,'docs/guide');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1120,height:1600},deviceScaleFactor:2});
 await page.goto(pathToFileURL(path.join(dir,'specifications.html')).href);
 await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:path.join(dir,'images/09-specifications.png'),fullPage:true});
 console.log('Hardware guide PNG rendered; the distribution builder includes final PNG guides only');
}finally{await browser.close();}
