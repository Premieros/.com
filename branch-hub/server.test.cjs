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
 const config={host:'127.0.0.1',port:0,branchId:'demo_branch',token,dataDir:dir};
 let hub=createHub(config);
 try{
  let {port}=await hub.listen();
  assert.equal((await request(port,'GET','/health')).status,200);
  assert.equal((await request(port,'GET','/api/v1/jobs')).status,401);
  const body={kind:'print',idempotencyKey:'receipt-sale-00001',payload:{receipt:'sample'}};
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
 assert.throws(()=>createHub({host:'0.0.0.0',port:0,branchId:'branch_001',token,dataDir:os.tmpdir()}),/LAN_REQUIRES_TLS_CERTIFICATE/);
});
