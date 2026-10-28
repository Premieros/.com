'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createHub}=require('./server.cjs');
const {createPrintWorker}=require('./print-worker.cjs');
const token='test-printer-token-32-characters-long';
async function setup(fn) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-print-'));
 const hub=createHub({port:0,dataDir:dir,organizationId:'org_001',branchId:'branch_001',token});
 try {await hub.listen();await fn(hub,dir);} finally {await hub.close();fs.rmSync(dir,{recursive:true,force:true});}
}
function insert(hub,id='job1') {
 hub.db.prepare("INSERT INTO jobs(id,branch_id,idempotency_key,kind,payload) VALUES(?,'branch_001',?,'print',?)")
 .run(id,'receipt-'+id,JSON.stringify({printerId:'cashier',text:'Sale 123\nTotal 25.00'}));
}
test('TCP printer receives one ESC/POS receipt even with concurrent worker attempts',async()=>{
 let received=Buffer.alloc(0), receiptDone;
 const receiptArrived=new Promise(resolve=>{receiptDone=resolve;});
 const printer=net.createServer(socket=>{socket.on('data',chunk=>{received=Buffer.concat([received,chunk]);});socket.on('end',receiptDone);});
 await new Promise(resolve=>printer.listen(0,'127.0.0.1',resolve));
 try {await setup(async hub=>{
  insert(hub);
  const worker=createPrintWorker(hub.db,'branch_001',{cashier:{host:'127.0.0.1',port:printer.address().port}});
  await Promise.all([worker.processOnce(),worker.processOnce()]);
  await receiptArrived;
  assert.equal(hub.db.prepare('SELECT state FROM print_dispatches').get().state,'submitted');
  assert.equal(await worker.processOnce(),false);
  assert.equal(received.toString('ascii').split('Sale 123').length,2);
  assert.equal(worker.retryFailed('job1'),false);
  await worker.stop();
 });} finally {await new Promise(resolve=>printer.close(resolve));}
});
test('pre-send printer failure allows explicit retry; uncertain delivery and crash never auto-retry',async()=>{
 await setup(async(hub,dir)=>{
  insert(hub);
  let calls=0;
  const worker=createPrintWorker(hub.db,'branch_001',{cashier:{host:'127.0.0.1',port:9100}},async()=>{
   calls++;const error=Error('DISCONNECTED');error.deliveryUncertain=calls>1;throw error;
  });
  await worker.processOnce();assert.equal(calls,1);
  assert.equal(await worker.processOnce(),false);
  assert.equal(worker.retryFailed('job1'),true);
  await worker.processOnce();assert.equal(calls,2);
  assert.equal(hub.db.prepare('SELECT state FROM print_dispatches').get().state,'uncertain');
  assert.equal(worker.retryFailed('job1'),false);
  insert(hub,'crash');
  hub.db.prepare("INSERT INTO print_dispatches(job_id,state,attempts) VALUES('crash','sending',1)").run();
  await worker.stop();
  const restarted=createPrintWorker(hub.db,'branch_001',{cashier:{host:'127.0.0.1',port:9100}},async()=>{calls++;});
  assert.equal(await restarted.processOnce(),false);assert.equal(calls,2);
  await restarted.stop();
 });
});
test('server generates one print job per sale, across repeated network requests',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-receipt-'));
 const hub=createHub({port:0,dataDir:dir,organizationId:'org_001',branchId:'branch_001',token,
  printers:{cashier:{host:'127.0.0.1',port:9100}}});
 try {
  const {port}=await hub.listen();
  const {createOfflineSalesEngine}=require('./offline-sales.cjs');
  const engine=createOfflineSalesEngine(hub.db,'branch_001');engine.setOpeningStock('sku',5,0);
  const sale=engine.commitSale({key:'print-sale-001',lines:[{sku:'sku',quantity:1,priceMinor:250}]});
  const url=`http://127.0.0.1:${port}/api/v1/offline/sales/${sale.saleId}/print`;
  const responses=await Promise.all(Array.from({length:8},()=>fetch(url,{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({printerId:'cashier'})}).then(r=>r.json())));
  assert.equal(new Set(responses.map(x=>x.jobId)).size,1);
  assert.equal(hub.db.prepare('SELECT count(*) n FROM jobs').get().n,1);
 } finally {await hub.close();fs.rmSync(dir,{recursive:true,force:true});}
});
