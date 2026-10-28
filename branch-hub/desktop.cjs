'use strict';
const { app, BrowserWindow, dialog, ipcMain, safeStorage, Tray, Menu } = require('electron');
const {localOrigin:desktopOrigin}=require('./local-origin.cjs');
const {pathToFileURL}=require('node:url');
const {createCloudClient}=require('./cloud-client.cjs');
const {createConfigVault}=require('./config-vault.cjs');
const {createEnrollmentController}=require('./enrollment.cjs');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
let worker;
if (!app.requestSingleInstanceLock()) { app.exit(0); }
let activeWindow, tray;
let setupWindow, localOrigin, localToken, localBackupKey, configVault;
const setupURL=pathToFileURL(path.join(__dirname,'ui/setup.html')).href;
function createWindow(status, localURL) {
 const win=new BrowserWindow({width:940,height:650,minWidth:650,minHeight:450,
  webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'setup-preload.cjs')}});
 const markup=`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>PremierOS Branch Hub</title><style>
 body{font-family:Segoe UI,Tahoma,Arial;background:#0b1730;color:#eaf1ff;margin:0;display:grid;place-items:center;min-height:100vh}
 main{max-width:650px;padding:45px;background:#132341;border:1px solid #38537d;border-radius:25px;box-shadow:0 25px 60px #0005}
 h1{font-size:32px}p{line-height:2;color:#bed0e9}.pill{color:#90ddff}
 </style><main><div class="pill">PREMIER OS • LOCAL BRANCH</div><h1>PremierOS Branch Hub</h1><p>${status}</p><p>هذه نسخة تأسيسية لإدارة خادم الفرع المحلي. لا تستخدمها حتى الآن لمعالجة المبيعات أو المدفوعات الفعلية.</p></main></html>`;
 activeWindow=win;
 win.on('close',event=>{if(worker&&!app.isQuitting&&tray){event.preventDefault();win.hide();}});
 win.loadURL(localURL || 'data:text/html;charset=UTF-8,'+encodeURIComponent(markup));
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(event,url)=>{
  if(!localURL || new URL(url).origin!==new URL(localURL).origin)event.preventDefault();
 });
}
function startHub(c) {
  desktopOrigin({hostname:c.localHostname||'127.0.0.1',port:c.port||3847,tls:Boolean(c.tlsKey)});
  localToken=c.token;localBackupKey=c.backupKey;
  if(process.platform==='win32'){
   app.setLoginItemSettings({openAtLogin:true});
   app.getFileIcon(process.execPath).then(icon=>{
    if(tray)return;tray=new Tray(icon);tray.setToolTip('Premier • خادم الفرع المحلي');
    const show=()=>{if(activeWindow&&!activeWindow.isDestroyed()){activeWindow.show();activeWindow.focus();}};
    tray.on('double-click',show);tray.setContextMenu(Menu.buildFromTemplate([{label:'فتح Premier',click:show},{type:'separator'},{label:'إيقاف خادم الفرع والخروج',click:()=>app.quit()}]));
   }).catch(()=>{});
  }
  const env={...process.env,ELECTRON_RUN_AS_NODE:'1',BRANCH_HUB_HOST:c.host||'127.0.0.1',
   BRANCH_HUB_BRANCH_ID:c.branchId,BRANCH_HUB_ORGANIZATION_ID:c.organizationId,
   BRANCH_HUB_UPDATE_PUBLIC_KEY:c.updatePublicKey||'',BRANCH_HUB_INSTALLATION_ID:c.hubDeviceId||'',BRANCH_HUB_CLOUD_REFRESH_TOKEN:c.cloudRefreshToken||'',BRANCH_HUB_TOKEN:c.token,BRANCH_HUB_BACKUP_KEY:c.backupKey||'',BRANCH_HUB_BACKUP_MIRROR:c.backupMirrorDir||'',BRANCH_HUB_PORT:String(c.port||3847),
   BRANCH_HUB_PRINTERS:JSON.stringify(c.printers||{}),BRANCH_HUB_TLS_KEY:c.tlsKey||'',BRANCH_HUB_TLS_CERT:c.tlsCert||'',
   BRANCH_HUB_DATA_DIR:path.join(app.getPath('userData'),'branch-data')};
  worker=fork(path.join(__dirname,'server.cjs'),[],{execPath:process.execPath,env,stdio:['ignore','ignore','ignore','ipc']});
  let ready=false;
  const timer=setTimeout(()=>{if(!ready){worker.kill();createWindow('تعذر بدء خادم الفرع في الوقت المحدد.');}},15000);
  worker.on('message',message=>{
   if(message?.type==='persist-cloud-token'){
    try{if(typeof message.refreshToken!=='string'||message.refreshToken.length<8||message.refreshToken.length>8192)throw Error('INVALID_SESSION');
     const next={...c,cloudRefreshToken:message.refreshToken};configVault.save(next,true);c.cloudRefreshToken=message.refreshToken;
     worker.send({type:'cloud-token-saved',requestId:message.requestId,ok:true});
    }catch{worker.send({type:'cloud-token-saved',requestId:message.requestId,ok:false});}
    return;
   }
   if(message?.type!=='ready' || ready)return;
   ready=true;clearTimeout(timer);
   const url=desktopOrigin({hostname:c.localHostname||'127.0.0.1',port:message.port,tls:Boolean(c.tlsKey)})+'/';
   localOrigin=new URL(url).origin;
   createWindow('',url);
   if(setupWindow&&!setupWindow.isDestroyed())setupWindow.close();
  });
  worker.on('error',()=>{clearTimeout(timer);dialog.showErrorBox('PremierOS','تعذر بدء خادم الفرع المحلي');});
  worker.on('exit',()=>{clearTimeout(timer);if(!app.isQuitting){if(activeWindow)dialog.showErrorBox('PremierOS','خادم الفرع متوقف. أعد تشغيل التطبيق بعد مراجعة الإعدادات.');else createWindow('تعذر بدء خادم الفرع. راجع الإعدادات.');}});
}
app.whenReady().then(()=>{
 try {
  const userDir=app.getPath('userData');
  const vault=createConfigVault(userDir,safeStorage);configVault=vault;
  const c=vault.loadOrMigrate();
  ipcMain.handle('hub:local-credential',event=>{
   if(!activeWindow || event.sender!==activeWindow.webContents || event.senderFrame!==event.sender.mainFrame ||
     !localOrigin || new URL(event.senderFrame.url).origin!==localOrigin)throw Error('FORBIDDEN');
   return localToken;
  });
  ipcMain.handle('hub:export-recovery-key',async event=>{
   if(!activeWindow||event.sender!==activeWindow.webContents||event.senderFrame!==event.sender.mainFrame||
     !localOrigin||new URL(event.senderFrame.url).origin!==localOrigin||!localBackupKey)return {ok:false};
   const choice=await dialog.showSaveDialog(activeWindow,{title:'احفظ مفتاح الاستعادة في مكان آمن منفصل عن النسخ الاحتياطية',defaultPath:'Premier-recovery-key.json',filters:[{name:'Recovery key',extensions:['json']}]});
   if(choice.canceled)return {ok:false,canceled:true};
   try{
    fs.writeFileSync(choice.filePath,JSON.stringify({format:'premier-backup-key-v1',projectRef:'hvqlkapynjfjikqithvd',backupKey:localBackupKey},null,2),{flag:'wx',mode:0o600});
    return {ok:true};
   }catch{return {ok:false,error:'RECOVERY_KEY_SAVE_FAILED'};}
  });
  if(c){startHub(c);return;}
  const controller=createEnrollmentController({client:createCloudClient(),vault,dataDir:path.join(userDir,'branch-data')});
  const trustedSetup=event=>setupWindow && !setupWindow.isDestroyed() && event.sender===setupWindow.webContents &&
    event.senderFrame===event.sender.mainFrame && event.senderFrame.url===setupURL;
  const errorCode=e=>['CLOUD_ACCESS_DENIED','BRANCH_ADMIN_REQUIRED','CLOUD_UNAVAILABLE','BRANCH_ACCESS_DENIED',
   'LOGIN_REQUIRED','ENROLLMENT_BUSY','BRANCH_BINDING_MISMATCH','OS_CREDENTIAL_VAULT_UNAVAILABLE'].includes(e.message)?e.message:'ENROLLMENT_FAILED';
  ipcMain.handle('hub:sign-in',async(event,input)=>{
   if(!trustedSetup(event))return {ok:false,error:'FORBIDDEN'};
   try{return {ok:true,...await controller.signIn(input)};}catch(e){return {ok:false,error:errorCode(e)};}
  });
  ipcMain.handle('hub:enroll',async(event,id)=>{
   if(!trustedSetup(event))return {ok:false,error:'FORBIDDEN'};
   try{
    const config=await controller.enroll(id);
    // Keep the setup window until the local UI exists, so window-all-closed cannot quit mid-enrollment.
    startHub(config);return {ok:true};
   }catch(e){return {ok:false,error:errorCode(e)};}
  });
  setupWindow=new BrowserWindow({width:760,height:780,minWidth:560,minHeight:550,
   webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'setup-preload.cjs')}});
  setupWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  setupWindow.webContents.on('will-navigate',event=>event.preventDefault());
  setupWindow.on('closed',()=>controller.clear());
  setupWindow.loadFile(path.join(__dirname,'ui/setup.html'));
 } catch(error) {
  createWindow(error.message==='OS_CREDENTIAL_VAULT_UNAVAILABLE'?'حماية إعدادات الجهاز غير متاحة. لم تُحفظ أي بيانات دخول.':'إعداد ربط الفرع غير صالح؛ تم منع تشغيل الخادم لحماية بيانات الفرع.');
 }
});
app.on('before-quit',()=>{ app.isQuitting=true; if(worker && !worker.killed)worker.kill(); });
app.on('second-instance',()=>{if(activeWindow){if(activeWindow.isMinimized())activeWindow.restore();activeWindow.focus();}});
app.on('window-all-closed',()=>app.quit());
