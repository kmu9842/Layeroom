const {app,BrowserWindow,ipcMain,protocol,session,screen,Menu,Tray,nativeImage,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {options,configure,bounds}=require('./options.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'widget',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const snapshot=JSON.parse(fs.readFileSync(path.join(__dirname,'snapshot.json'),'utf8'));
const identity=crypto.createHash('sha256').update(__dirname).digest('hex').slice(0,24);
const preferencesRoot=path.join(process.env.LOCALAPPDATA||app.getPath('appData'),'LayeroomWidgets','preferences',identity);
fs.mkdirSync(preferencesRoot,{recursive:true});app.setPath('userData',preferencesRoot);app.setName('Layeroom Widget');
const preferenceFile=path.join(preferencesRoot,'widget.json');
let previous={};try{previous=JSON.parse(fs.readFileSync(preferenceFile,'utf8'));}catch{}
let current=options(previous,{autoRotate:snapshot.autoRotate,followMouse:snapshot.card.settings.tilt}),win,tray,timer,saveTimer;
// Test-only debugging is opt-in, local, and absent from normal launches.
if(/^\d{4,5}$/.test(process.env.LAYEROOM_WIDGET_TEST_PORT||'')){app.commandLine.appendSwitch('remote-debugging-address','127.0.0.1');app.commandLine.appendSwitch('remote-debugging-port',process.env.LAYEROOM_WIDGET_TEST_PORT);}
app.commandLine.appendSwitch('disable-background-networking');
function persist(){if(!win||win.isDestroyed())return;const next=preferenceFile+'.tmp';fs.writeFileSync(next,JSON.stringify({...current,bounds:win.getBounds()}));fs.renameSync(next,preferenceFile);}
function saveSoon(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{persist();}catch{}},250);}
function senderAllowed(event){return win&&!win.isDestroyed()&&event.sender===win.webContents&&event.senderFrame?.url==='widget://app/index.html';}
function menuTemplate(){return[
 {label:snapshot.card.title,enabled:false},{type:'separator'},
 {label:'자동 회전',type:'checkbox',checked:current.autoRotate,click:()=>apply({autoRotate:!current.autoRotate})},
 {label:'마우스 따라 회전',type:'checkbox',checked:current.followMouse,click:()=>apply({followMouse:!current.followMouse})},
 {label:'크기',submenu:[['small','작게'],['medium','보통'],['large','크게']].map(([size,label])=>({label,type:'radio',checked:current.size===size,click:()=>apply({size})}))},
 {type:'separator'},{label:'위젯 보기',click:()=>{win.show();win.focus();}},{label:'종료',click:()=>app.quit()},
];}
function refreshMenu(){tray?.setContextMenu(Menu.buildFromTemplate(menuTemplate()));}
function apply(patch){const next=configure(current,patch);const changedSize=next.size!==current.size;current=next;if(changedSize){const b=win.getBounds(),display=screen.getDisplayMatching(b);win.setBounds(bounds(current.size,display.workArea,b));}persist();win.webContents.send('widget:options',current);refreshMenu();return current;}
function clampWindow(){if(!win||win.isDestroyed())return;const b=win.getBounds();win.setBounds(bounds(current.size,screen.getDisplayMatching(b).workArea,b));saveSoon();}
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',()=>{if(win){win.show();win.focus();}});
 app.whenReady().then(async()=>{
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));session.defaultSession.setPermissionCheckHandler(()=>false);
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('widget://app/')&&!details.url.startsWith('data:')&&!details.url.startsWith('devtools:')}));
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png'};
  protocol.handle('widget',async request=>{
   try{const url=new URL(request.url);if(url.hostname!=='app'||request.method!=='GET')return new Response('',{status:403});const decoded=decodeURIComponent(url.pathname);const assets=decoded.startsWith('/assets/'),root=path.join(__dirname,assets?'assets':'web'),relative=assets?decoded.slice(8):decoded.slice(1),target=path.resolve(root,relative||'index.html');
    if(!target.startsWith(root+path.sep)||!types[path.extname(target)])return new Response('',{status:403});const data=await fs.promises.readFile(target);return new Response(data,{headers:{'Content-Type':types[path.extname(target)],'Cache-Control':'no-store'}});
   }catch{return new Response('',{status:404});}
  });
  const savedBounds=previous.bounds&&['x','y','width','height'].every(k=>Number.isFinite(previous.bounds[k]))?previous.bounds:null;
  const display=savedBounds?screen.getDisplayMatching(savedBounds):screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const icon=nativeImage.createFromPath(path.join(__dirname,'assets',snapshot.card.id,'cutout.png')).resize({width:32,height:32});
  win=new BrowserWindow({...bounds(current.size,display.workArea,savedBounds),title:snapshot.card.title,icon,frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,maximizable:false,fullscreenable:false,alwaysOnTop:true,skipTaskbar:true,show:false,hasShadow:false,thickFrame:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:false}});
  win.setMenu(null);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());win.webContents.on('will-attach-webview',event=>event.preventDefault());
  ipcMain.handle('widget:initialize',event=>{if(!senderAllowed(event))throw Error('Invalid sender');return {snapshot,options:current};});
  ipcMain.handle('widget:configure',(event,patch)=>{if(!senderAllowed(event))throw Error('Invalid sender');return apply(patch);});
  ipcMain.on('widget:close',event=>{if(senderAllowed(event))app.quit();});
  win.webContents.on('context-menu',()=>Menu.buildFromTemplate(menuTemplate()).popup({window:win}));
  win.on('moved',saveSoon);win.on('closed',()=>{win=null;});
  tray=new Tray(icon);tray.setToolTip(snapshot.card.title.slice(0,120));tray.on('double-click',()=>{win.show();win.webContents.send('widget:settings');});refreshMenu();
  win.once('ready-to-show',()=>win.showInactive());await win.loadURL('widget://app/index.html');
  timer=setInterval(()=>{if(!win||win.isDestroyed()||!current.followMouse)return;const cursor=screen.getCursorScreenPoint(),b=win.getBounds(),area=screen.getDisplayMatching(b).workArea;win.webContents.send('widget:pointer',{x:Math.max(-1,Math.min(1,(cursor.x-b.x-b.width/2)/Math.max(b.width,area.width*.35))),y:Math.max(-1,Math.min(1,(cursor.y-b.y-b.height/2)/Math.max(b.height,area.height*.35)))});},33);
  screen.on('display-removed',clampWindow);screen.on('display-metrics-changed',clampWindow);
 }).catch(error=>{dialog.showErrorBox('Layeroom 위젯',error.message);app.quit();});
}
app.on('before-quit',()=>{clearInterval(timer);clearTimeout(saveTimer);try{persist();}catch{}tray?.destroy();});
app.on('window-all-closed',()=>app.quit());
