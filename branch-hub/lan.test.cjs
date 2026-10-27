'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const https=require('node:https');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHub}=require('./server.cjs');
// These public test fixtures are excluded from the installer. Never use them in a branch.
const cert=path.join(__dirname,'fixtures/test-only-cert.pem');
const key=path.join(__dirname,'fixtures/test-only-key.pem');
test('TLS LAN listener serves offline assets and authenticates devices with certificate verification',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-tls-'));
 const hub=createHub({host:'0.0.0.0',port:0,dataDir:dir,organizationId:'org_001',branchId:'branch_001',token:'a'.repeat(40),tlsKey:key,tlsCert:cert});
 try {
  const {port}=await hub.listen();
  const get=pathname=>new Promise((resolve,reject)=>{
   const req=https.get({hostname:'127.0.0.1',port,path:pathname,ca:fs.readFileSync(cert)},res=>{
    let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers}));
   });req.on('error',reject);
  });
  const page=await get('/');assert.equal(page.status,200);assert.match(page.body,/lang="ar"/);
  assert.match(page.headers['content-security-policy'],/frame-ancestors 'none'/);
  assert.equal((await get('/hub.js')).status,200);assert.equal((await get('/hub.css')).status,200);
  assert.equal((await get('/api/v1/session')).status,401);
  assert.equal((await get('/fixtures/test-only-key.pem')).status,401);
 } finally {await hub.close();fs.rmSync(dir,{recursive:true,force:true});}
});
