'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('electronAPI',Object.freeze({
 isElectron:true,
 supportsHtmlTemplates:true,
 getPrinters:()=>ipcRenderer.invoke('erp:printers'),
 printSilent:options=>ipcRenderer.invoke('erp:print',options),
 kickDrawer:()=>Promise.resolve({success:false,error:'DRAWER_NOT_CONFIGURED'}),
 getSystemInfo:()=>ipcRenderer.invoke('erp:system-info'),
}));
