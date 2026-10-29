'use strict';
// The real ERP receives a printer-only bridge, never hub/admin credentials.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {PROJECT_REF,UUID}=require('./cloud-client.cjs');
const escape=text=>String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function printableDocument(input){
 const width=input.paperWidthMm;
 const policy="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
 const head=`<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>@page{margin:0}html,body{width:${width}mm!important;max-width:${width}mm!important;margin:0!important;padding:0!important;background:white!important;color:black!important}*{box-sizing:border-box}pre{white-space:pre-wrap;overflow-wrap:anywhere;direction:rtl;text-align:right;font-family:Tahoma,Arial,sans-serif;padding:2mm}</style>`;
 const body=input.html||`<pre>${escape(input.text)}</pre>`;
 return `<!doctype html><html lang="ar" dir="rtl"><head>${head}</head><body>${body}</body></html>`;
}
function validatePrint(input){
 if(!input||!UUID.test(input.requestId||'')||typeof input.printerName!=='string'||input.printerName.length<1||input.printerName.length>256||/[\u0000-\u001f]/.test(input.printerName))throw Error('INVALID_PRINT_REQUEST');
 const html=typeof input.html==='string'?input.html:'',text=typeof input.text==='string'?input.text:'';
 if(!html&&!text||Buffer.byteLength(html)+Buffer.byteLength(text)>2*1024*1024)throw Error('INVALID_PRINT_CONTENT');
 const copies=input.copies??1,width=input.paperWidthMm??80;
 if(!Number.isInteger(copies)||copies<1||copies>5||![58,80].includes(width))throw Error('INVALID_PRINT_LAYOUT');
 return {requestId:input.requestId,printerName:input.printerName,html,text,copies,paperWidthMm:width};
}
function createErpPrinter({file,organizationId,branchId,printers,dispatch}){
 if(!UUID.test(organizationId||'')||!UUID.test(branchId||''))throw Error('INVALID_PRINT_BINDING');
 fs.mkdirSync(path.dirname(file),{recursive:true});const db=new DatabaseSync(file);
 db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),project_ref TEXT NOT NULL,organization_id TEXT NOT NULL,branch_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS erp_print_jobs(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,printer_name TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('queued','sending','submitted','failed','uncertain')),error TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
 const identity=db.prepare('SELECT * FROM identity WHERE singleton=1').get();
 if(identity&&(identity.project_ref!==PROJECT_REF||identity.organization_id!==organizationId||identity.branch_id!==branchId)){db.close();throw Error('BRANCH_BINDING_MISMATCH');}
 if(!identity)db.prepare('INSERT INTO identity VALUES(1,?,?,?)').run(PROJECT_REF,organizationId,branchId);
 // A crash cannot prove that Windows did not already receive paper bytes.
 db.prepare("UPDATE erp_print_jobs SET state='uncertain',error='APP_RESTARTED_DURING_PRINT',updated_at=CURRENT_TIMESTAMP WHERE state='sending'").run();
 db.prepare("UPDATE erp_print_jobs SET state='failed',error='APP_RESTARTED_BEFORE_PRINT',updated_at=CURRENT_TIMESTAMP WHERE state='queued'").run();
 const tails=new Map(),active=new Map();let closing=false;
 const result=row=>({success:row.state==='submitted',jobId:row.id,state:row.state,paperConfirmed:false,...(row.error?{error:row.error}:{})});
 async function send(input){
  if(closing)throw Error('PRINT_SERVICE_STOPPING');
  if(input?.branchId!==undefined&&input.branchId!==branchId)throw Error('BRANCH_BINDING_MISMATCH');
  const job=validatePrint(input),payload=JSON.stringify(job),fingerprint=crypto.createHash('sha256').update(payload).digest('hex');
  const existing=db.prepare('SELECT * FROM erp_print_jobs WHERE id=?').get(job.requestId);
  if(existing){if(existing.fingerprint!==fingerprint)throw Error('PRINT_IDEMPOTENCY_CONFLICT');return active.get(job.requestId)||result(existing);}
  const destinations=await printers();if(!destinations.some(p=>p.name===job.printerName))throw Error('WINDOWS_PRINTER_NOT_FOUND');
  if(closing)throw Error('PRINT_SERVICE_STOPPING');
  // Discovery is async: another identical request may have committed meanwhile.
  const raced=db.prepare('SELECT * FROM erp_print_jobs WHERE id=?').get(job.requestId);
  if(raced){if(raced.fingerprint!==fingerprint)throw Error('PRINT_IDEMPOTENCY_CONFLICT');return active.get(job.requestId)||result(raced);}
  db.prepare("INSERT INTO erp_print_jobs(id,fingerprint,printer_name,payload,state) VALUES(?,?,?,?,'queued')").run(job.requestId,fingerprint,job.printerName,payload);
  const previous=tails.get(job.printerName)||Promise.resolve();
  const execution=previous.catch(()=>{}).then(async()=>{
   if(closing)return {success:false,jobId:job.requestId,state:'failed',error:'APP_STOPPING_BEFORE_PRINT',paperConfirmed:false};
   db.prepare("UPDATE erp_print_jobs SET state='sending',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(job.requestId);
   let outcome;
   try{outcome=await dispatch(job);}catch{outcome={state:'uncertain',error:'WINDOWS_PRINT_UNCONFIRMED'};}
   if(!outcome||!['submitted','failed','uncertain'].includes(outcome.state))outcome={state:'uncertain',error:'WINDOWS_PRINT_UNCONFIRMED'};
   if(closing)return {success:false,jobId:job.requestId,state:'uncertain',error:'APP_STOPPING_DURING_PRINT',paperConfirmed:false};
   db.prepare('UPDATE erp_print_jobs SET state=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(outcome.state,outcome.error||null,job.requestId);
   return result(db.prepare('SELECT * FROM erp_print_jobs WHERE id=?').get(job.requestId));
  }).finally(()=>{active.delete(job.requestId);if(tails.get(job.printerName)===execution)tails.delete(job.printerName);});
  active.set(job.requestId,execution);tails.set(job.printerName,execution);return execution;
 }
 return {send,close(){if(closing)return;closing=true;db.prepare("UPDATE erp_print_jobs SET state='uncertain',error='APP_STOPPING_DURING_PRINT' WHERE state='sending'").run();db.prepare("UPDATE erp_print_jobs SET state='failed',error='APP_STOPPING_BEFORE_PRINT' WHERE state='queued'").run();db.close();}};
}
function createElectronPrintDispatcher(BrowserWindow,{timeoutMs=15000}={}){
 const windows=new Set();let closed=false;
 async function dispatch(job){
  if(closed)return {state:'failed',error:'PRINT_SERVICE_STOPPING'};
  let win,attempted=false,timer;
  try{
   win=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,javascript:false,partition:'erp-print-'+crypto.randomUUID()}});windows.add(win);
   win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   win.webContents.session.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{let protocol='';try{protocol=new URL(details.url).protocol;}catch{}callback({cancel:!['data:','about:'].includes(protocol)});});
   win.webContents.on('will-navigate',event=>event.preventDefault());
   const operation=(async()=>{
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(printableDocument(job)));
    attempted=true;
    return new Promise(resolve=>win.webContents.print({silent:true,printBackground:true,deviceName:job.printerName,copies:job.copies,margins:{marginType:'none'}},success=>resolve(success?{state:'submitted'}:{state:'uncertain',error:'WINDOWS_PRINT_UNCONFIRMED'})));
   })();
   return await Promise.race([operation,new Promise(resolve=>{timer=setTimeout(()=>resolve({state:attempted?'uncertain':'failed',error:attempted?'WINDOWS_PRINT_TIMEOUT_UNCONFIRMED':'PRINT_DOCUMENT_TIMEOUT'}),timeoutMs);})]);
  }catch{return {state:attempted?'uncertain':'failed',error:attempted?'WINDOWS_PRINT_UNCONFIRMED':'PRINT_DOCUMENT_FAILED'};}
  finally{clearTimeout(timer);if(win){windows.delete(win);if(!win.isDestroyed())win.destroy();}}
 }
 return {dispatch,close(){closed=true;for(const win of windows)if(!win.isDestroyed())win.destroy();windows.clear();}};
}
function registerErpPrinting({ipcMain,getWindow,getOrigin,getPrinter,version}){
 const trusted=event=>{try{const win=getWindow();return win&&!win.isDestroyed()&&event.sender===win.webContents&&event.senderFrame===event.sender.mainFrame&&new URL(event.senderFrame.url).origin===new URL(getOrigin()).origin;}catch{return false;}};
 ipcMain.handle('erp:printers',async event=>{if(!trusted(event))throw Error('FORBIDDEN');return (await getWindow().webContents.getPrintersAsync()).map(p=>({name:p.name,displayName:p.displayName||p.name,isDefault:p.isDefault,status:p.status}));});
 ipcMain.handle('erp:print',async(event,options)=>{
  if(!trusted(event)||!getPrinter())return {success:false,error:'FORBIDDEN'};
  try{return await getPrinter().send({...options,requestId:options?.requestId??crypto.randomUUID()});}catch(error){return {success:false,error:['INVALID_PRINT_REQUEST','INVALID_PRINT_CONTENT','INVALID_PRINT_LAYOUT','WINDOWS_PRINTER_NOT_FOUND','PRINT_SERVICE_STOPPING','PRINT_IDEMPOTENCY_CONFLICT','BRANCH_BINDING_MISMATCH'].includes(error.message)?error.message:'PRINT_REQUEST_FAILED'};}
 });
 ipcMain.handle('erp:system-info',event=>{if(!trusted(event))throw Error('FORBIDDEN');return {isElectron:true,platform:process.platform,version,hostname:require('node:os').hostname()};});
 return ()=>{for(const channel of ['erp:printers','erp:print','erp:system-info'])ipcMain.removeHandler(channel);};
}
module.exports={createErpPrinter,createElectronPrintDispatcher,registerErpPrinting,validatePrint,printableDocument};
