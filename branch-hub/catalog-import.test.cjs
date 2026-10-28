'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createOfflineSalesEngine}=require('./offline-sales.cjs');
const {createCatalogImporter}=require('./catalog-import.cjs');
const org='11111111-1111-4111-8111-111111111111',branch='22222222-2222-4222-8222-222222222222',warehouse='55555555-5555-4555-8555-555555555555',product='66666666-6666-4666-8666-666666666666';
const sku=`p_${product}_${warehouse}`;
function snapshot(revision=1,quantity=10){return {organizationId:org,branchId:branch,warehouseId:warehouse,products:[{sku,productId:product,name:'منتج تجريبي',unitName:'piece',quantity,priceCommand:{id:`77777777-7777-4777-8777-${String(revision).padStart(12,'0')}`,organization_id:org,branch_id:branch,sku,revision,sale_price_minor:250,unit_cost_minor:100}}]};}
test('canonical catalog seeds only once, preserves offline quantities on refresh, and snapshots the exact product/warehouse into sales',()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 try{
  const engine=createOfflineSalesEngine(db,branch),importer=createCatalogImporter(db,{organizationId:org,branchId:branch});
  assert.equal(importer.apply(snapshot()).seeded,1);
  const sale=engine.commitSale({key:'mapped-checkout-001',lines:[{sku,quantity:2,priceMinor:250}]});
  const event=JSON.parse(db.prepare('SELECT payload FROM offline_outbox WHERE sale_id=?').get(sale.saleId).payload);
  assert.deepEqual(event.lines[0].canonical,{productId:product,warehouseId:warehouse,unitName:'piece',productName:'منتج تجريبي'});
  assert.equal(importer.apply(snapshot(2,99)).seeded,0);
  assert.equal(db.prepare('SELECT quantity FROM offline_stock').get().quantity,8);
  assert.equal(db.prepare('SELECT cost_minor FROM offline_sale_lines').get().cost_minor,200);
  assert.throws(()=>importer.apply({...snapshot(),branchId:org}),/INVALID_CATALOG_SNAPSHOT/);
 }finally{db.close();}
});
test('bad catalog price or changed unit rolls back the whole import and its stock/audit changes',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  createOfflineSalesEngine(db,branch);const importer=createCatalogImporter(db,{organizationId:org,branchId:branch});
  const bad=snapshot();bad.products[0].priceCommand.unit_cost_minor=-1;
  assert.throws(()=>importer.apply(bad),/INVALID_CLOUD_COMMAND/);
  assert.equal(db.prepare('SELECT count(*) n FROM offline_stock').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM hub_audit').get().n,0);
  importer.apply(snapshot());const changed=snapshot(2);changed.products[0].unitName='box';
  assert.throws(()=>importer.apply(changed),/CATALOG_LINK_CONFLICT/);
 }finally{db.close();}
});
