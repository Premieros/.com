'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createErpPrinter,createElectronPrintDispatcher,registerErpPrinting,printableDocument}=require('./erp-print.cjs');
const organizationId='11111111-1111-4111-8111-111111111111',branchId='22222222-2222-4222-8222-222222222222';
const job=()=>({requestId:crypto.randomUUID(),printerName:'XP-80C',text:'اختبار غير مالي',copies:1,paperWidthMm:80});
async function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'erp-print-'));try{await fn(path.join(root,'jobs.sqlite'));}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('real ERP print persists one submission for concurrent requests and restart; never claims paper',async()=>fixture(async file=>{
 let sent=0;const create=()=>createErpPrinter({file,organizationId,branchId,printers:async()=>[{name:'XP-80C'}],dispatch:async()=>{sent++;return {state:'submitted'};}});
 const printer=create(),input=job();try{const results=await Promise.all(Array.from({length:5},()=>printer.send(input)));assert(results.every(r=>r.success&&r.paperConfirmed===false&&r.jobId===input.requestId));assert.equal(sent,1);await assert.rejects(printer.send({...input,text:'different'}),/IDEMPOTENCY_CONFLICT/);}finally{printer.close();}
 const reopened=create();try{assert.equal((await reopened.send(input)).state,'submitted');assert.equal(sent,1);}finally{reopened.close();}
}));
test('printer names are exact, layout bounded and unknown driver ACK blocks retries',async()=>fixture(async file=>{
 let sent=0;const printer=createErpPrinter({file,organizationId,branchId,printers:async()=>[{name:'XP-80C'}],dispatch:async()=>{sent++;throw Error('lost ACK');}});
 try{await assert.rejects(printer.send({...job(),branchId:'33333333-3333-4333-8333-333333333333'}),/BINDING_MISMATCH/);await assert.rejects(printer.send({...job(),printerName:'Microsoft Print to PDF'}),/PRINTER_NOT_FOUND/);await assert.rejects(printer.send({...job(),copies:1.5}),/LAYOUT/);await assert.rejects(printer.send({...job(),paperWidthMm:100}),/LAYOUT/);const input=job();assert.equal((await printer.send(input)).state,'uncertain');assert.equal((await printer.send(input)).state,'uncertain');assert.equal(sent,1);}finally{printer.close();}
}));
test('a crashed sending job becomes uncertain while an unattempted job fails without auto-printing',async()=>fixture(async file=>{
 let sent=0;const create=()=>createErpPrinter({file,organizationId,branchId,printers:async()=>[{name:'XP-80C'}],dispatch:async()=>{sent++;return {state:'submitted'};}});
 let printer=create();const input=job();await printer.send(input);printer.close();const db=new DatabaseSync(file);db.prepare("UPDATE erp_print_jobs SET state='sending'").run();db.close();printer=create();try{assert.equal((await printer.send(input)).state,'uncertain');assert.equal(sent,1);}finally{printer.close();}
 const queued=new DatabaseSync(file);queued.prepare("UPDATE erp_print_jobs SET state='queued'").run();queued.close();printer=create();try{assert.equal((await printer.send(input)).state,'failed');assert.equal(sent,1);}finally{printer.close();}
}));
test('receipt history refuses another organization or branch',async()=>fixture(async file=>{const config={file,organizationId,branchId,printers:async()=>[],dispatch:async()=>{throw Error('not allowed');}};createErpPrinter(config).close();assert.throws(()=>createErpPrinter({...config,branchId:'33333333-3333-4333-8333-333333333333'}),/BINDING_MISMATCH/);}));
test('drivers are serialized per printer and remain independent of another physical printer',async()=>fixture(async file=>{
 let release;const blocked=new Promise(resolve=>{release=resolve;});const order=[];
 const printer=createErpPrinter({file,organizationId,branchId,printers:async()=>[{name:'XP-80C'},{name:'XP-58C'}],dispatch:async input=>{order.push(input.text);if(input.text==='first')await blocked;return {state:'submitted'};}});
 try{const first=printer.send({...job(),text:'first'}),second=printer.send({...job(),text:'second'}),other=printer.send({...job(),printerName:'XP-58C',text:'other'});await other;assert.deepEqual(order,['first','other']);release();await Promise.all([first,second]);assert.deepEqual(order,['first','other','second']);}finally{release();printer.close();}
}));
test('print renderer disables JavaScript and all external/file resources before rendering Arabic HTML',async()=>{
 let settings,filter,callback,html,physicalAttempts=0;
 class Window {constructor(options){settings=options;this.webContents={session:{webRequest:{onBeforeRequest:(f,handler)=>{filter=f;callback=handler;}}},setWindowOpenHandler:()=>{},on:()=>{},print:(_options,done)=>{physicalAttempts++;done(true);}};}async loadURL(url){html=decodeURIComponent(url.split(',').slice(1).join(','));}isDestroyed(){return false;}destroy(){}}
 const dispatcher=createElectronPrintDispatcher(Window);try{assert.equal((await dispatcher.dispatch({...job(),html:'<img src="https://invalid.test"><script>throw 1</script>'})).state,'submitted');assert.equal(settings.webPreferences.javascript,false);assert.equal(settings.webPreferences.sandbox,true);assert.deepEqual(filter,{urls:['<all_urls>']});for(const url of ['https://example.test','http://127.0.0.1:3847/','file:///C:/secret']){let cancelled;callback({url},r=>{cancelled=r.cancel;});assert.equal(cancelled,true);}assert.match(html,/script-src 'none'/);assert.match(html,/connect-src 'none'/);assert.equal(physicalAttempts,1);}finally{dispatcher.close();}
});
test('a print callback timeout is uncertain and never makes a second driver attempt',async()=>{
 let attempts=0;
 class Window {constructor(){this.webContents={session:{webRequest:{onBeforeRequest:()=>{}}},setWindowOpenHandler:()=>{},on:()=>{},print:()=>{attempts++;}};}async loadURL(){}isDestroyed(){return false;}destroy(){}}
 const dispatcher=createElectronPrintDispatcher(Window,{timeoutMs:20});try{const result=await dispatcher.dispatch(job());assert.equal(result.state,'uncertain');assert.equal(attempts,1);}finally{dispatcher.close();}
});
test('plain text is escaped before reaching the offline print renderer',()=>{const html=printableDocument({...job(),text:'<img src=x>قهوة'});assert.match(html,/&lt;img/);assert(!html.includes('<img'));});
test('printer IPC rejects other windows, subframes and remote navigation without invoking the driver',async()=>{
 const handlers=new Map(),ipcMain={handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)};let sends=0;
 const frame={url:'http://127.0.0.1:3848/'},contents={mainFrame:frame,getPrintersAsync:async()=>[{name:'XP-80C'}]};const win={isDestroyed:()=>false,webContents:contents};
 const remove=registerErpPrinting({ipcMain,getWindow:()=>win,getOrigin:()=>frame.url,getPrinter:()=>({send:async()=>{sends++;return {success:true};}}),version:'test'});
 try{for(const event of [{sender:{},senderFrame:frame},{sender:contents,senderFrame:{url:frame.url}},{sender:contents,senderFrame:{url:'https://hvqlkapynjfjikqithvd.supabase.co'}}])assert.equal((await handlers.get('erp:print')(event,job())).error,'FORBIDDEN');assert.equal(sends,0);assert.equal((await handlers.get('erp:print')({sender:contents,senderFrame:frame},job())).success,true);assert.equal(sends,1);assert.equal((await handlers.get('erp:printers')({sender:contents,senderFrame:frame}))[0].name,'XP-80C');}finally{remove();}assert.equal(handlers.size,0);
});
