'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fork}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {once}=require('node:events');
test('abrupt hub process loss preserves committed WAL sale and retry identity', {timeout:20000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-crash-'));
 const token='crash-test-credential-32-characters-long';
 let child;
 async function start(){
  child=fork(path.join(__dirname,'server.cjs'),[],{env:{...process.env,BRANCH_HUB_DATA_DIR:dir,
   BRANCH_HUB_HOST:'127.0.0.1',BRANCH_HUB_PORT:'0',BRANCH_HUB_BRANCH_ID:'branch_001',
   BRANCH_HUB_ORGANIZATION_ID:'org_001',BRANCH_HUB_TOKEN:token,BRANCH_HUB_PRINTERS:'{}',
   BRANCH_HUB_TLS_KEY:'',BRANCH_HUB_TLS_CERT:''},stdio:['ignore','ignore','ignore','ipc']});
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('CHILD_READY_TIMEOUT')),5000);
   child.once('error',e=>{clearTimeout(timer);reject(e);});
   child.once('exit',code=>{clearTimeout(timer);reject(Error('CHILD_EXIT:'+code));});
   child.once('message',m=>{clearTimeout(timer);if(m.type==='ready')resolve(m.port);else reject(Error('INVALID_READY'));});
  });
 }
 async function kill(){if(child && child.exitCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}child=null;}
 try {
  let port=await start();
  const api=async(route,body)=>{
   const res=await fetch(`http://127.0.0.1:${port}/api/v1/${route}`,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
   return {status:res.status,data:await res.json()};
  };
  const scope={organizationId:'org_001',branchId:'branch_001'};
  assert.equal((await api('offline/stock/opening',{...scope,sku:'coffee',quantity:4,unitCostMinor:100})).status,201);
  const sale={...scope,key:'crash-checkout-001',lines:[{sku:'coffee',quantity:2,priceMinor:250}]};
  const first=await api('offline/sales',sale);assert.equal(first.status,201);
  await kill();port=await start();
  const retry=await api('offline/sales',sale);assert.equal(retry.status,200);assert.equal(retry.data.saleId,first.data.saleId);
  assert.equal((await api('offline/stock')).data.stock[0].quantity,2);
  assert.equal((await api('offline/sync/status')).data.pending,1);
  assert.equal((await api('offline/integrity')).data.ok,true);
 }finally{await kill();fs.rmSync(dir,{recursive:true,force:true});}
});
