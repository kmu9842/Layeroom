import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
const root=process.cwd(),folder=path.join(path.resolve(process.env.LAYEROOM_ARCHIVE_CHECK||'test-results/current-archive'),'Layeroom'),exe=path.join(folder,'Layeroom.exe');
assert.ok(folder.startsWith(path.join(root,'test-results')+path.sep));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const env={...process.env,PATH:path.join(process.env.WINDIR,'System32'),PYTHONHOME:'Z:\\missing',PYTHONPATH:'Z:\\missing'};
const child=spawn(exe,['--no-browser'],{cwd:root,env,windowsHide:false,stdio:'ignore'});
try{
 execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tests/setup_window.ps1'),'-AppPid',String(child.pid),'-Screenshot',path.join(root,'test-results/final-installer.png')],{windowsHide:true,timeout:90000});
 assert.equal(await fs.access(path.join(folder,'_internal/runtime')).then(()=>true,()=>false),false);
 assert.equal(await fs.access(path.join(folder,'_internal/portable/components.json')).then(()=>true,()=>false),true);
}finally{
 execFileSync(exe,['--stop'],{env,windowsHide:true});for(let i=0;i<100&&child.exitCode===null;i++)await pause(100);
 if(child.exitCode===null){process.kill(child.pid);throw Error('Stop must close the first-run wizard');}
}
assert.equal(child.exitCode,0);
console.log('PASS: final EXE extracts only app code, asks for installation and exits cleanly');
