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
