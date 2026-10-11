import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
const root=process.cwd(),folder=path.resolve(process.env.LAYEROOM_CAPTURE_APP||path.join(root,'test-results/character-capture/Layeroom')),exe=path.join(folder,'Layeroom.exe');
assert.ok(folder.startsWith(path.join(root,'test-results')+path.sep),'Capture app must stay in test-results');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const env={...process.env,PATH:path.join(process.env.WINDIR,'System32'),PYTHONHOME:'Z:\\missing',PYTHONPATH:'Z:\\missing'};
await fs.mkdir(folder,{recursive:true});
await fs.copyFile(path.join(root,'build/Layeroom/Layeroom.exe'),exe);
await fs.cp(path.join(root,'build/Layeroom/guide'),path.join(folder,'guide'),{recursive:true});
let child,state;
async function stop(){if(!child)return;execFileSync(exe,['--stop'],{env,windowsHide:true});for(let i=0;i<100&&child.exitCode===null;i++)await wait(100);assert.equal(child.exitCode,0);child=null;}
try{
 child=spawn(exe,['--no-browser'],{env,cwd:root,stdio:'ignore',windowsHide:false});
 execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tests/setup_window.ps1'),'-AppPid',String(child.pid),'-Screenshot',path.join(root,'docs/guide/screenshots/00-setup.png')],{windowsHide:true,timeout:90000});
 assert.equal(await fs.access(path.join(folder,'_internal/runtime')).then(()=>true,()=>false),false);
 assert.equal(await fs.access(path.join(folder,'_internal/portable/components.json')).then(()=>true,()=>false),true);
 await stop();
 execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-X','utf8','scripts/prepare_guide_runtime.py','--target',path.join(folder,'_internal')],{cwd:root,windowsHide:true});
 child=spawn(exe,['--no-browser'],{env,cwd:root,stdio:'ignore',windowsHide:true});
 for(let i=0;i<480;i++){try{state=JSON.parse((await fs.readFile(path.join(folder,'_internal/data/runtime.json'),'utf8')).replace(/^\uFEFF/,''));if(state.launcher===child.pid&&(await(await fetch(state.url+'/api/health')).json()).instance===state.instance)break;}catch{}state=null;await wait(250);}
 assert.ok(state,'Embedded application must start using only its own runtime');
 assert.deepEqual(await(await fetch(state.url+'/api/capabilities')).json(),{ai:true,widget:true,setup:true});
 assert.deepEqual(await(await fetch(state.url+'/api/cards')).json(),[]);
 const capture=spawn(process.execPath,['scripts/capture_guide.mjs'],{cwd:root,env:{...process.env,LAYEROOM_GUIDE_APP:folder},windowsHide:true,stdio:'inherit'});
 assert.equal(await new Promise(resolve=>capture.on('exit',resolve)),0);
 let cpu;
 if(!process.argv.includes('--capture-only')){
 const data=await fs.readFile('D:/Download/52030b49d1dc6af958cfc86993ac388dbb5aaed5.png');
 const form=new FormData();form.append('file',new Blob([data]),'Character.png');
 const response=await fetch(state.url+'/api/upload',{method:'POST',body:form});assert.equal(response.status,202);
 const job=await response.json();let done;
 for(let i=0;i<2400;i++){done=await(await fetch(state.url+'/api/jobs/'+job.id)).json();if(['completed','failed'].includes(done.status))break;await wait(250);}
 assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(done.metrics.device,'cpu');
 assert.equal(done.worker_pid,undefined);
 cpu=done.metrics;
 }
 const report={embeddedApplication:true,isolatedRuntime:true,actualGuideArtwork:true,cpu,captureOnly:!cpu,completed:true};
 await fs.writeFile(path.join(root,'test-results/embedded-app.json'),JSON.stringify(report,null,2));
 console.log('PASS: embedded EXE, exact installation path, real character guides, widget EXE'+(cpu?' and CPU inference':''));
}finally{await stop();}
