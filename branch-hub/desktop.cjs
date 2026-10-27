'use strict';
const { app, BrowserWindow, dialog } = require('electron');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
let worker;
function configPath() { return path.join(app.getPath('userData'), 'branch-config.json'); }
function loadConfig() {
 const file=configPath();
 if (!fs.existsSync(file)) return null;
 const c=JSON.parse(fs.readFileSync(file,'utf8'));
 if (!/^[a-zA-Z0-9_-]{3,80}$/.test(c.branchId||'') ||
     !/^[a-zA-Z0-9_-]{3,80}$/.test(c.organizationId||'') ||
     typeof c.token!=='string' || c.token.length<32) throw Error('INVALID_BRANCH_ENROLLMENT');
 return c;
}
function createWindow(status) {
 const win=new BrowserWindow({width:940,height:650,minWidth:650,minHeight:450,
  webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 const markup=`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>PremierOS Branch Hub</title><style>
 body{font-family:Segoe UI,Tahoma,Arial;background:#0b1730;color:#eaf1ff;margin:0;display:grid;place-items:center;min-height:100vh}
 main{max-width:650px;padding:45px;background:#132341;border:1px solid #38537d;border-radius:25px;box-shadow:0 25px 60px #0005}
 h1{font-size:32px}p{line-height:2;color:#bed0e9}.pill{color:#90ddff}
 </style><main><div class="pill">PREMIER OS • LOCAL BRANCH</div><h1>PremierOS Branch Hub</h1><p>${status}</p><p>هذه نسخة تأسيسية لإدارة خادم الفرع المحلي. لا تستخدمها حتى الآن لمعالجة المبيعات أو المدفوعات الفعلية.</p></main></html>`;
 win.loadURL('data:text/html;charset=UTF-8,'+encodeURIComponent(markup));
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',event=>event.preventDefault());
}
app.whenReady().then(()=>{
 try {
  const c=loadConfig();
  if (!c) {createWindow('لم يتم ربط الجهاز بفرع بعد. يتطلب التشغيل إعداد ربط فرع آمن؛ لم يتم تنفيذ التسجيل المركزي أو التوقيع بعد.');return;}
  const env={...process.env,ELECTRON_RUN_AS_NODE:'1',BRANCH_HUB_HOST:'127.0.0.1',
   BRANCH_HUB_BRANCH_ID:c.branchId,BRANCH_HUB_ORGANIZATION_ID:c.organizationId,
   BRANCH_HUB_TOKEN:c.token,BRANCH_HUB_DATA_DIR:path.join(app.getPath('userData'),'branch-data')};
  worker=fork(path.join(__dirname,'server.cjs'),[],{execPath:process.execPath,env,stdio:'ignore'});
  worker.on('error',()=>dialog.showErrorBox('PremierOS','تعذر بدء خادم الفرع المحلي'));
  createWindow('خادم الفرع المحلي يعمل على الجهاز فقط. اتصال الشبكة المحلية يحتاج شهادة TLS وإقران الأجهزة أولًا.');
 } catch { createWindow('إعداد ربط الفرع غير صالح؛ تم منع تشغيل الخادم لحماية بيانات الفرع.'); }
});
app.on('before-quit',()=>{ if(worker && !worker.killed)worker.kill(); });
app.on('window-all-closed',()=>app.quit());
