'use strict';
// Source-only acceptance app. Uses the actual Electron safeStorage and sandboxed preload on Windows.
const {app,BrowserWindow,ipcMain,safeStorage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {createConfigVault}=require('./config-vault.cjs');
const {pathToFileURL}=require('node:url');
const report=process.argv[2];
const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-electron-security-'));
fs.mkdirSync(path.join(root,'profile'));
app.setPath('userData',path.join(root,'profile'));
app.whenReady().then(async()=>{
 let window;
 try{
  const vault=createConfigVault(root,safeStorage);
  const config={organizationId:'test_org',branchId:'test_branch',token:'actual-os-protected-test-token-123456789'};
  vault.save(config);assert.deepEqual(vault.load(),config);
  assert.equal(fs.readFileSync(vault.file,'utf8').includes(config.token),false);
  const setupURL=pathToFileURL(path.join(__dirname,'ui/setup.html')).href;
  let loginCalls=0;
  ipcMain.handle('hub:sign-in',(event,input)=>{
   assert.equal(event.senderFrame.url,setupURL);assert.equal(event.senderFrame,event.sender.mainFrame);
   assert.equal(input.email,'test@example.test');assert.equal(input.password,'fake-password');loginCalls++;
   return {ok:true,branches:[{id:'test_branch',organizationId:'test_org',name:'Test Branch'}]};
  });
  window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'setup-preload.cjs')}});
  await window.loadFile(path.join(__dirname,'ui/setup.html'));
  const state=await window.webContents.executeJavaScript(`(async()=>{
   document.getElementById('email').value='test@example.test';document.getElementById('password').value='fake-password';
   document.getElementById('setup-login').requestSubmit();
   for(let i=0;i<100;i++){
    if(!document.getElementById('setup-branch').hidden)break;
    await new Promise(r=>setTimeout(r,20));
   }
   return {visible:!document.getElementById('setup-branch').hidden,password:document.getElementById('password').value,
    branch:document.getElementById('branch-choice').value,node:typeof window.require};
  })()`);
  assert.equal(loginCalls,1);assert.deepEqual(state,{visible:true,password:'',branch:'test_branch',node:'undefined'});
  fs.writeFileSync(report,JSON.stringify({ok:true,dpapi:true,sandboxedSetup:true}));
 }catch(error){console.error(error);if(report)fs.writeFileSync(report,JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
 finally{if(window)window.destroy();fs.rmSync(root,{recursive:true,force:true});app.exit(process.exitCode||0);}
});
