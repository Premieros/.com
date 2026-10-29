'use strict';
// Real sandbox/preload + Chromium PDF print sink. NEVER calls a physical driver.
const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createErpPrinter,createElectronPrintDispatcher,registerErpPrinting}=require('./erp-print.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'premier-erp-print-'));
fs.mkdirSync(path.join(root,'profile'));app.setPath('userData',path.join(root,'profile'));app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 let win,server,printer,dispatcher,remove;let pdfs=0;
 try{
  class PdfSink extends BrowserWindow {constructor(options){super(options);this.webContents.print=(_settings,callback)=>{this.webContents.printToPDF({printBackground:true}).then(bytes=>{assert.equal(bytes.subarray(0,4).toString(),'%PDF');assert(bytes.length>1000);pdfs++;callback(true);},()=>callback(false));};}}
  dispatcher=createElectronPrintDispatcher(PdfSink);
  printer=createErpPrinter({file:path.join(root,'jobs.sqlite'),organizationId:'11111111-1111-4111-8111-111111111111',branchId:'22222222-2222-4222-8222-222222222222',printers:async()=>[{name:'ERP PDF test sink'}],dispatch:dispatcher.dispatch});
  server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="ar"><body>Printer bridge</body></html>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
  win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'erp-preload.cjs')}});
  remove=registerErpPrinting({ipcMain,getWindow:()=>win,getOrigin:()=>url,getPrinter:()=>printer,version:'self-test'});await win.loadURL(url);
  const result=await win.webContents.executeJavaScript(`(async()=>{const api=window.electronAPI;if(!api)throw Error('PRELOAD_MISSING');const denied=await api.printSilent({printerName:'not an installed destination',text:'ignored'});const receipt=await api.printSilent({printerName:'ERP PDF test sink',html:'<h1 dir="rtl">اختبار غير مالي — قهوة عربية</h1>',paperWidthMm:80,copies:1});return {require:typeof window.require,hub:typeof window.branchHub,templates:api.supportsHtmlTemplates,denied,receipt};})()`);
  assert.equal(result.require,'undefined');assert.equal(result.hub,'undefined');assert.equal(result.templates,true);assert.equal(result.denied.success,false);assert.equal(result.receipt.success,true);assert.equal(result.receipt.paperConfirmed,false);assert.equal(pdfs,1);
  console.log(JSON.stringify({ok:true,sandboxedPreload:true,credentialBridge:false,arabicPdfSink:true,physicalPrintSent:false}));
 }catch(error){console.error(error);process.exitCode=1;}
 finally{if(remove)remove();if(win)win.destroy();if(dispatcher)dispatcher.close();if(printer)printer.close();if(server)await new Promise(resolve=>server.close(resolve));try{fs.rmSync(root,{recursive:true,force:true});}catch{}app.exit(process.exitCode||0);}
});
