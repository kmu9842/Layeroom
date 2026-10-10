import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
const root=process.cwd(),folder=path.join(root,'test-results/location/Layeroom'),chosen=path.join(root,'test-results/location/SelectedFolder');
const exe=path.join(folder,'Layeroom.exe'),wait=ms=>new Promise(r=>setTimeout(r,ms));
const env={...process.env,PATH:path.join(process.env.WINDIR,'System32'),PYTHONHOME:'Z:\\missing',PYTHONPATH:'Z:\\missing'};
await fs.mkdir(folder,{recursive:true});await fs.mkdir(chosen,{recursive:true});
await fs.copyFile(path.join(root,'build/Layeroom/Layeroom.exe'),exe);
execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-X','utf8','scripts/prepare_guide_runtime.py','--target',path.join(chosen,'_internal')],{cwd:root,windowsHide:true});
let child,state;
const powershell=(file,args)=>execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,file),...args],{windowsHide:true,timeout:90000,stdio:'inherit'});
async function stop(){if(!child)return;execFileSync(exe,['--stop'],{env,windowsHide:true});for(let i=0;i<100&&child.exitCode===null;i++)await wait(100);assert.equal(child.exitCode,0);child=null;}
async function ready(){state=null;for(let i=0;i<480;i++){try{state=JSON.parse((await fs.readFile(path.join(chosen,'_internal/data/runtime.json'),'utf8')).replace(/^\uFEFF/,''));if(state.launcher===child.pid&&(await(await fetch(state.url+'/api/health')).json()).instance===state.instance)return;}catch{}state=null;await wait(250);}assert.ok(state,'Server must start from selected folder');}
try{
 child=spawn(exe,['--no-browser'],{env,cwd:root,windowsHide:false,stdio:'ignore'});
 powershell('tests/setup_window.ps1',['-AppPid',String(child.pid),'-Screenshot',path.join(root,'docs/guide/screenshots/00-setup.png')]);
 powershell('tests/folder_picker.ps1',['-AppPid',String(child.pid),'-Destination',chosen,'-Screenshot',path.join(root,'docs/guide/screenshots/00-location.png')]);
 powershell('tests/setup_window.ps1',['-AppPid',String(child.pid),'-Screenshot',path.join(root,'test-results/location/selected-location.png'),'-Install']);
 await ready();
 assert.equal(JSON.parse(await fs.readFile(path.join(folder,'Layeroom.settings.json'),'utf8')).install_folder,chosen);
 assert.deepEqual(await(await fetch(state.url+'/api/cards')).json(),[]);
 assert.deepEqual(await(await fetch(state.url+'/api/capabilities')).json(),{ai:true,widget:true,setup:true});
 await stop();child=spawn(exe,['--no-browser'],{env,cwd:root,windowsHide:true,stdio:'ignore'});await ready();
 console.log('PASS: Explorer selection, installation in selected folder, configuration persistence and restart');
 await fs.writeFile(path.join(root,'test-results/install-location-result.json'),JSON.stringify({nativeExplorer:true,selectedFolder:chosen,persisted:true,restarted:true},null,2));
}finally{await stop();}
