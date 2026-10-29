'use strict';
// Source-only acceptance app. Uses the actual Electron safeStorage and sandboxed preload on Windows.
const {app,BrowserWindow,ipcMain,safeStorage,net}=require('electron');
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
 let window,fixture;
 try{
  const vault=createConfigVault(root,safeStorage);
  const config={organizationId:'test_org',branchId:'test_branch',token:'actual-os-protected-test-token-123456789'};
  vault.save(config);assert.deepEqual(vault.load(),config);
  assert.equal(fs.readFileSync(vault.file,'utf8').includes(config.token),false);
  // Real Chromium networking + OS vault; isolated local fixture, no cloud credentials.
  const http=require('node:http');
  const {createCloudClient,PROJECT_URL}=require('./cloud-client.cjs');
  const {createEnrollmentController}=require('./enrollment.cjs');
  const branch='22222222-2222-4222-8222-222222222222',org='11111111-1111-4111-8111-111111111111';
  let confirmations=0;
  fixture=http.createServer((req,res)=>{
   const route=new URL(req.url,'http://localhost');
   if(route.pathname==='/rest/v1/branches'&&route.searchParams.has('id')&&++confirmations===1){res.writeHead(503);res.end();return;}
   const result=route.pathname==='/auth/v1/token'?{access_token:'native-test-access-token-long',refresh_token:'native-refresh-token'}:
    route.pathname==='/auth/v1/user'?{id:'33333333-3333-4333-8333-333333333333'}:
    route.pathname==='/rest/v1/rpc/can_permission'?true:
    route.pathname==='/rest/v1/branches'?[{id:branch,organization_id:org,name:'Native test',is_active:true}]:null;
   assert.notEqual(result,null);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
  });
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const client=createCloudClient((url,options)=>{assert.equal(new URL(url).origin,PROJECT_URL);return net.fetch('http://127.0.0.1:'+fixture.address().port+url.slice(PROJECT_URL.length),options);},{retryDelayMs:0});
  const networkVault=createConfigVault(path.join(root,'network-vault'),safeStorage);
  const enrollment=createEnrollmentController({client,vault:networkVault,dataDir:path.join(root,'network-data')});
  await enrollment.signIn({email:'native@example.test',password:'fixture-only'});
  await enrollment.enroll(branch);assert.equal(confirmations,2);assert.equal(networkVault.load().branchId,branch);
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
  fs.writeFileSync(report,JSON.stringify({ok:true,dpapi:true,sandboxedSetup:true,chromiumEnrollmentRetry:true}));
 }catch(error){console.error(error);if(report)fs.writeFileSync(report,JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
 finally{if(fixture)await new Promise(resolve=>fixture.close(resolve));if(window)window.destroy();fs.rmSync(root,{recursive:true,force:true});app.exit(process.exitCode||0);}
});
