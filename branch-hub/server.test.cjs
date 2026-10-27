'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createHub } = require('./server.cjs');
const token = 'test-branch-local-secret-32-characters-long';
const request = (port,method,pathname,payload,authorization) => new Promise((resolve,reject)=>{
 const req=http.request({hostname:'127.0.0.1',port,method,path:pathname,headers:{
 ...(authorization?{authorization:'Bearer '+authorization}:{}),
 'content-type':'application/json'}},res=>{
 let data='';res.on('data',x=>data+=x);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(data)}));});
 req.on('error',reject);req.end(payload?JSON.stringify(payload):undefined);
});
test('WAN-independent hub persists one job per idempotency key and enforces auth',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premier-hub-'));
 const config={host:'127.0.0.1',port:0,branchId:'demo_branch',organizationId:'demo_org',token,dataDir:dir};
 let hub=createHub(config);
 try{
  let {port}=await hub.listen();
  assert.equal((await request(port,'GET','/health')).status,200);
  assert.equal((await request(port,'GET','/api/v1/jobs')).status,401);
  const body={organizationId:'demo_org',branchId:'demo_branch',kind:'print',idempotencyKey:'receipt-sale-00001',payload:{receipt:'sample'}};
  const first=await request(port,'POST','/api/v1/jobs',body,token);
  const second=await request(port,'POST','/api/v1/jobs',body,token);
  assert.equal(first.status,202);assert.equal(second.status,202);
  assert.equal(first.data.job.id,second.data.job.id);
  assert.equal((await request(port,'GET','/api/v1/jobs',null,token)).data.jobs.length,1);
  await hub.close();hub=null;
  hub=createHub(config);({port}=await hub.listen());
  assert.equal((await request(port,'GET','/api/v1/jobs',null,token)).data.jobs.length,1);
 }finally{if(hub)await hub.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('LAN binding without TLS is rejected',()=>{
 assert.throws(()=>createHub({host:'0.0.0.0',port:0,branchId:'branch_001',organizationId:'demo_org',token,dataDir:os.tmpdir()}),/LAN_REQUIRES_TLS_CERTIFICATE/);
});

test('refuses switching a persisted branch database to another branch or organization', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premier-binding-'));
 const base={host:'127.0.0.1',port:0,branchId:'branch_001',organizationId:'org_001',token,dataDir:dir};
 const hub=createHub(base);
 try {
  const {port}=await hub.listen();
  const result=await request(port,'POST','/api/v1/jobs',
    {organizationId:'org_002',branchId:'branch_001',kind:'print',idempotencyKey:'receipt-1234567',payload:{text:'test'}},token);
  assert.equal(result.status,403);
 } finally {await hub.close();}
 try {
  assert.throws(()=>createHub({...base,branchId:'branch_002'}),/BRANCH_BINDING_MISMATCH/);
  assert.throws(()=>createHub({...base,organizationId:'org_002'}),/BRANCH_BINDING_MISMATCH/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('receipt draft is stored atomically, deduplicated and queued across restarts', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premier-receipt-'));
 const config={host:'127.0.0.1',port:0,branchId:'branch_001',organizationId:'org_001',token,dataDir:dir};
 let hub=createHub(config);
 const item={organizationId:'org_001',branchId:'branch_001',deviceId:'cashier_01',idempotencyKey:'sale-receipt-001',totalMinor:1250,currency:'EGP',receipt:{description:'test'}};
 try {
  let {port}=await hub.listen();
  const first=await request(port,'POST','/api/v1/receipts',item,token);
  assert.equal(first.status,201);
  const duplicate=await request(port,'POST','/api/v1/receipts',item,token);
  assert.equal(duplicate.status,200);
  assert.equal(duplicate.data.receiptId,first.data.receiptId);
  const conflict=await request(port,'POST','/api/v1/receipts',{...item,totalMinor:1251},token);
  assert.equal(conflict.status,409);
  const cross=await request(port,'POST','/api/v1/receipts',{...item,branchId:'branch_002'},token);
  assert.equal(cross.status,403);
  assert.equal((await request(port,'GET','/api/v1/sync/status',null,token)).data.pending,1);
  await hub.close();hub=null;
  hub=createHub(config);({port}=await hub.listen());
  assert.equal((await request(port,'GET','/api/v1/receipts',null,token)).data.receipts.length,1);
  assert.equal((await request(port,'GET','/api/v1/sync/status',null,token)).data.pending,1);
 } finally {if(hub)await hub.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('parallel submissions share one receipt and one outbox event', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premier-parallel-'));
 const hub=createHub({host:'127.0.0.1',port:0,branchId:'branch_001',organizationId:'org_001',token,dataDir:dir});
 try {
  const {port}=await hub.listen();
  const body={organizationId:'org_001',branchId:'branch_001',deviceId:'device_001',
    idempotencyKey:'sale-parallel-001',totalMinor:2500,currency:'EGP',receipt:{items:[{qty:1}]}};
  const responses=await Promise.all(Array.from({length:20},()=>request(port,'POST','/api/v1/receipts',body,token)));
  assert.equal(responses.filter(x=>x.status===201).length,1);
  assert.equal(responses.filter(x=>x.status===200).length,19);
  assert.equal(new Set(responses.map(x=>x.data.receiptId)).size,1);
  assert.equal(hub.db.prepare('SELECT count(*) AS n FROM sync_outbox').get().n,1);
 } finally {await hub.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('integrity audit and read-only pending sync survive restart without premature acknowledgement', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premier-integrity-'));
 const config={host:'127.0.0.1',port:0,branchId:'branch_001',organizationId:'org_001',token,dataDir:dir};
 let hub=createHub(config);
 try {
  let {port}=await hub.listen();
  const record={organizationId:'org_001',branchId:'branch_001',deviceId:'device_001',
    idempotencyKey:'receipt-integrity-001',totalMinor:150,currency:'EGP',receipt:{items:[]}};
  assert.equal((await request(port,'POST','/api/v1/receipts',record,token)).status,201);
  assert.equal((await request(port,'GET','/api/v1/integrity',null,token)).data.ok,true);
  const pending=await request(port,'GET','/api/v1/sync/pending',null,token);
  assert.equal(pending.data.events.length,1);
  assert.equal(pending.data.cloudAcknowledgementImplemented,false);
  assert.equal((await request(port,'GET','/api/v1/sync/status',null,token)).data.pending,1);
  await hub.close();hub=null;
  hub=createHub(config);({port}=await hub.listen());
  assert.equal((await request(port,'GET','/api/v1/integrity',null,token)).data.outbox,1);
  assert.equal((await request(port,'GET','/api/v1/sync/status',null,token)).data.pending,1);
 } finally {if(hub)await hub.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('print job key cannot be reused for a different document', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premier-print-conflict-'));
 const hub=createHub({host:'127.0.0.1',port:0,branchId:'branch_001',organizationId:'org_001',token,dataDir:dir});
 try {
  const {port}=await hub.listen();
  const job={organizationId:'org_001',branchId:'branch_001',kind:'print',idempotencyKey:'print-job-0001',payload:{text:'first'}};
  assert.equal((await request(port,'POST','/api/v1/jobs',job,token)).status,202);
  assert.equal((await request(port,'POST','/api/v1/jobs',{...job,payload:{text:'changed'}},token)).status,409);
  assert.equal((await request(port,'GET','/api/v1/jobs',null,token)).data.jobs.length,1);
 } finally {await hub.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('consistent backup restores branch binding, receipt, and pending outbox', async () => {
 const { DatabaseSync } = require('node:sqlite');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premier-backup-'));
 const config={host:'127.0.0.1',port:0,branchId:'branch_001',organizationId:'org_001',token,dataDir:dir};
 let hub=createHub(config);
 try {
  const {port}=await hub.listen();
  const receipt={organizationId:'org_001',branchId:'branch_001',deviceId:'device_001',
   idempotencyKey:'receipt-backup-001',totalMinor:499,currency:'EGP',receipt:{lines:[{sku:'abc',qty:1}]}};
  assert.equal((await request(port,'POST','/api/v1/receipts',receipt,token)).status,201);
  const snapshot=hub.createLocalBackup();
  assert.ok(snapshot.bytes>0);
  const filepath=path.join(dir,'backups',snapshot.filename);
  const restored=new DatabaseSync(filepath,{readOnly:true});
  try {
   assert.equal(restored.prepare('PRAGMA quick_check').get().quick_check,'ok');
   assert.equal(restored.prepare('SELECT branch_id FROM hub_identity').get().branch_id,'branch_001');
   assert.equal(restored.prepare('SELECT count(*) AS n FROM local_receipts').get().n,1);
   assert.equal(restored.prepare("SELECT count(*) AS n FROM sync_outbox WHERE status='pending'").get().n,1);
  } finally {restored.close();}
  await hub.close();hub=null;
  fs.copyFileSync(filepath,path.join(dir,'branch-hub.sqlite'));
  hub=createHub(config);
  const rebound=await hub.listen();
  assert.equal((await request(rebound.port,'GET','/api/v1/sync/status',null,token)).data.pending,1);
  await hub.close();hub=null;
  assert.throws(()=>createHub({...config,branchId:'branch_002'}),/BRANCH_BINDING_MISMATCH/);
 } finally {if(hub)await hub.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('offline sales API commits stock, journal and outbox atomically with branch isolation', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premier-sale-api-'));
 const hub=createHub({host:'127.0.0.1',port:0,branchId:'branch_001',organizationId:'org_001',token,dataDir:dir});
 try {
  hub.db.prepare('INSERT INTO offline_stock(branch_id,sku,quantity,unit_cost_minor) VALUES(?,?,?,?)').run('branch_001','item_001',5,100);
  const {port}=await hub.listen();
  const input={organizationId:'org_001',branchId:'branch_001',key:'sale-api-0001',
   lines:[{sku:'item_001',quantity:2,priceMinor:250}]};
  const first=await request(port,'POST','/api/v1/offline/sales',input,token);
  assert.equal(first.status,201);
  assert.equal(first.data.totalMinor,500);
  assert.equal((await request(port,'POST','/api/v1/offline/sales',input,token)).status,200);
  assert.equal((await request(port,'POST','/api/v1/offline/sales',{...input,branchId:'branch_002'},token)).status,403);
  assert.equal((await request(port,'POST','/api/v1/offline/sales',{...input,key:'sale-api-0002',lines:[{sku:'item_001',quantity:9,priceMinor:250}]},token)).status,409);
  assert.equal((await request(port,'GET','/api/v1/offline/stock',null,token)).data.stock[0].quantity,3);
  assert.equal(hub.db.prepare('SELECT count(*) AS n FROM offline_outbox').get().n,1);
  const movements=await request(port,'GET','/api/v1/offline/stock/movements',null,token);
  assert.equal(movements.status,200);
  assert.equal(movements.data.movements.length,1);
  assert.equal(movements.data.movements[0].delta,-2);
  assert.equal(movements.data.movements[0].balance_after,3);
  const journal=hub.db.prepare('SELECT SUM(debit_minor) dr,SUM(credit_minor) cr FROM offline_journal').get();
  assert.equal(journal.dr,journal.cr);
 } finally {await hub.close();fs.rmSync(dir,{recursive:true,force:true});}
});
