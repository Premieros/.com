'use strict';
// Run inside packaged Electron too: catches missing files and unsupported node:sqlite.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHub}=require('./server.cjs');
const assert=require('node:assert/strict');
const {createCatalogImporter}=require('./catalog-import.cjs');
const {createOfflineSalesEngine}=require('./offline-sales.cjs');
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-package-'));
 const organizationId='11111111-1111-4111-8111-111111111111',branchId='22222222-2222-4222-8222-222222222222';
 const warehouseId='55555555-5555-4555-8555-555555555555',productId='66666666-6666-4666-8666-666666666666';
 const sku=`p_${productId}_${warehouseId}`;
 const hub=createHub({dataDir:dir,branchId,organizationId,token:'s'.repeat(40),port:0});
 try {
  const {port}=await hub.listen();
  const response=await fetch(`http://127.0.0.1:${port}/health`);
  if(!response.ok || !(await response.json()).ok)throw Error('PACKAGED_HEALTH_FAILED');
  for(const asset of ['/','/hub.js','/hub.css']) {
   const result=await fetch(`http://127.0.0.1:${port}${asset}`);
   if(!result.ok || !(await result.text()).length)throw Error('PACKAGED_UI_MISSING: '+asset);
  }
  // Exercise newly packaged catalog/mapping files and SQLite transactions without any cloud access.
  const installationId=hub.db.prepare('SELECT installation_id FROM hub_identity').get().installation_id;
  createCatalogImporter(hub.db,{organizationId,branchId,installationId}).apply({organizationId,branchId,warehouseId,
   products:[{sku,productId,name:'Packaged fixture',unitName:'piece',quantity:3,priceCommand:{
    id:'77777777-7777-4777-8777-777777777777',organization_id:organizationId,branch_id:branchId,sku,revision:1,sale_price_minor:250,unit_cost_minor:100}}]});
  const engine=createOfflineSalesEngine(hub.db,branchId),input={key:'packaged-sale-001',lines:[{sku,quantity:1,priceMinor:250}]};
  engine.commitSale(input);assert.equal(engine.commitSale(input).duplicate,true);
  assert.equal(hub.db.prepare('SELECT quantity FROM offline_stock').get().quantity,2);
  assert.equal(hub.db.prepare('SELECT count(*) n FROM offline_sales').get().n,1);
  assert.equal(JSON.parse(hub.db.prepare('SELECT payload FROM offline_outbox').get().payload).lines[0].canonical.productId,productId);
  const call=async(route,body,credential='s'.repeat(40),employeeSession='')=>{
   const result=await fetch(`http://127.0.0.1:${port}/api/v1/${route}`,{method:'POST',headers:{authorization:'Bearer '+credential,'content-type':'application/json','x-hub-session':employeeSession},body:JSON.stringify(body)});
   assert(result.ok,route+' '+result.status);return result.json();
  };
  const device=await call('devices',{organizationId,branchId,name:'Packaged till',role:'cashier'});
  await call('staff',{organizationId,branchId,username:'packaged',name:'Packaged employee',role:'cashier',password:'Packaged-employee-12345'});
  const employee=await call('staff/login',{username:'packaged',password:'Packaged-employee-12345'},device.token);
  const staffResponse=await fetch(`http://127.0.0.1:${port}/api/v1/session`,{headers:{authorization:'Bearer '+device.token,'x-hub-session':employee.token}});
  const staffSession=await staffResponse.json();assert.equal(staffSession.staffName,'Packaged employee');assert(staffSession.permissions.includes('sell'));
  hub.createLocalBackup();
  console.log('PACKAGED_RUNTIME_OK',process.versions.node);
 }finally{await hub.close();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
