const {contextBridge,ipcRenderer}=require('electron');
function subscribe(channel,callback){const listener=(_event,value)=>callback(value);ipcRenderer.on(channel,listener);return()=>ipcRenderer.removeListener(channel,listener);}
contextBridge.exposeInMainWorld('widget',{
 initialize:()=>ipcRenderer.invoke('widget:initialize'),
 configure:patch=>ipcRenderer.invoke('widget:configure',patch),
 close:()=>ipcRenderer.send('widget:close'),
 onOptions:callback=>subscribe('widget:options',callback),
 onPointer:callback=>subscribe('widget:pointer',callback),
 onSettings:callback=>subscribe('widget:settings',callback),
});
