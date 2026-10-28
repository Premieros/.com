'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('branchHub',{
 signIn:input=>ipcRenderer.invoke('hub:sign-in',input),
 enroll:branchId=>ipcRenderer.invoke('hub:enroll',branchId),
 localCredential:()=>ipcRenderer.invoke('hub:local-credential'),
});
