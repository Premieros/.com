'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {createHub}=require('./server.cjs');
const {createPrinterRegistry}=require('./printer-registry.cjs');
const {createPrintWorker}=require('./print-worker.cjs');
const {bitmapToEscPos}=require('./raster-receipt.cjs');
const {createOfflineSalesEngine}=require('./offline-sales.cjs');
const token='printer-settings-test-credential-123456789';
const receipt={saleId:'77777777-7777-4777-8777-777777777777',createdAt:'2026-10-28',totalMinor:250,lines:[{label:'قهوة',quantity:1,priceMinor:250}]};
const pixels=Buffer.alloc(384*4,255);pixels[0]=pixels[1]=pixels[2]=0;const bytes=bitmapToEscPos({width:384,height:1,bitmap:pixels});
async function setup(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-printer-config-'));const hub=createHub({port:0,dataDir:dir,organizationId:'org_001',branchId:'branch_001',token});try{await hub.listen();await fn(hub,dir);}finally{await hub.close();fs.rmSync(dir,{recursive:true,force:true});}}
test('printer settings reject public destinations and preserve pending job destinations; audit failure rolls back config and memory',async()=>{
 await setup(async hub=>{
  const registry=createPrinterRegistry(hub.db,'branch_001'),config={host:'127.0.0.1',port:9100,format:'raster',dots:384};
  assert.throws(()=>registry.configure('cashier',{...config,host:'8.8.8.8'}),/INVALID_PRINTER/);
  registry.configure('cashier',config);
  hub.db.prepare("INSERT INTO jobs(id,branch_id,idempotency_key,kind,payload) VALUES('pending','branch_001','settings-pending','print',?)").run(JSON.stringify({printerId:'cashier',receipt}));
  assert.throws(()=>registry.configure('cashier',{...config,port:9101}),/PENDING_JOBS/);
  assert.equal(registry.printers.cashier.port,9100);
  hub.db.exec("UPDATE jobs SET status='done'; CREATE TRIGGER fail_printer_config BEFORE INSERT ON hub_audit WHEN NEW.action='printer.configure' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END");
  assert.throws(()=>registry.configure('cashier',{...config,port:9101}),/injected/);assert.equal(registry.printers.cashier.port,9100);
  assert.equal(JSON.parse(hub.db.prepare('SELECT config FROM hub_printers').get().config).port,9100);
  hub.db.exec('DROP TRIGGER fail_printer_config');registry.configure('cashier',{...config,port:9101});
  assert.equal(createPrinterRegistry(hub.db,'branch_001',{cashier:config}).printers.cashier.port,9101);
 });
});
test('raster renderer failure sends no bytes; uncertain raster transmission is never retried',async()=>{
 await setup(async hub=>{
  hub.db.prepare("INSERT INTO jobs(id,branch_id,idempotency_key,kind,payload) VALUES('raster','branch_001','raster-failure','print',?)").run(JSON.stringify({printerId:'cashier',receipt}));
  let renders=0,sends=0;const worker=createPrintWorker(hub.db,'branch_001',{cashier:{host:'127.0.0.1',port:9100,format:'raster',dots:384}},async()=>{sends++;const error=Error('connection dropped');error.deliveryUncertain=true;throw error;},{renderReceipt:async()=>{renders++;if(renders===1)throw Error('RASTER_RENDER_TIMEOUT');return bytes;}});
  try{
   await worker.processOnce();assert.equal(sends,0);assert.equal(hub.db.prepare('SELECT state FROM print_dispatches').get().state,'failed');
   assert.equal(worker.retryFailed('raster'),true);await worker.processOnce();assert.equal(sends,1);assert.equal(hub.db.prepare('SELECT state FROM print_dispatches').get().state,'uncertain');
   assert.equal(worker.retryFailed('raster'),false);assert.equal(await worker.processOnce(),false);assert.equal(renders,2);
  }finally{await worker.stop();}
 });
});
test('administrator configures a raster printer through HTTP and repeated receipts send once over TCP',async()=>{
 let arrived;const arrival=new Promise(resolve=>{arrived=resolve;});let calls=0,received=Buffer.alloc(0);
 const printer=net.createServer(socket=>{calls++;socket.on('data',chunk=>{received=Buffer.concat([received,chunk]);});socket.on('end',arrived);});
 await new Promise(resolve=>printer.listen(0,'127.0.0.1',resolve));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-raster-http-'));let hub;
 try{
  hub=createHub({port:0,dataDir:dir,organizationId:'org_001',branchId:'branch_001',token,renderReceipt:async model=>{assert.equal(model.totalMinor,250);return bytes;}});const {port}=await hub.listen();
  const api=async(route,method='GET',body,credential=token)=>{const response=await fetch(`http://127.0.0.1:${port}/api/v1/${route}`,{method,headers:{authorization:'Bearer '+credential},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};};
  const scope={organizationId:'org_001',branchId:'branch_001'},settings={...scope,host:'127.0.0.1',port:printer.address().port,format:'raster',dots:384};
  const device=(await api('devices','POST',{...scope,name:'Till',role:'cashier'})).body;
  assert.equal((await api('printers/cashier','PUT',settings,device.token)).status,403);
  assert.equal((await api('printers/cashier','PUT',{...settings,branchId:'other_branch'})).status,403);
  assert.equal((await api('printers/cashier','PUT',settings)).status,200);
  assert.equal((await api('printers','GET',null,device.token)).body.details,undefined);
  const engine=createOfflineSalesEngine(hub.db,'branch_001');engine.setOpeningStock('sku',2,100);const sale=engine.commitSale({key:'raster-http-sale-001',lines:[{sku:'sku',quantity:1,priceMinor:250}]});
  const route=`offline/sales/${sale.saleId}/print`,jobs=await Promise.all(Array.from({length:6},()=>api(route,'POST',{printerId:'cashier'},device.token)));
  assert(jobs.every(x=>x.status===202));assert.equal(new Set(jobs.map(x=>x.body.jobId)).size,1);
  await hub.printWorker.processOnce();await arrival;assert.equal(calls,1);assert.deepEqual(received,bytes);
  const file=hub.createLocalBackup();assert(file.filename);
 }finally{if(hub)await hub.close();await new Promise(resolve=>printer.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
