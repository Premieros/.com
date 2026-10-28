'use strict';
const {UUID}=require('./cloud-client.cjs');
const {createDeviceRegistry}=require('./devices.cjs');
const {createSyncStore}=require('./cloud-sync.cjs');
function createCatalogImporter(db,{organizationId,branchId,installationId}){
 db.exec(`CREATE TABLE IF NOT EXISTS offline_item_links (
  branch_id TEXT NOT NULL,sku TEXT NOT NULL,product_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,
  unit_name TEXT NOT NULL,product_name TEXT NOT NULL,PRIMARY KEY(branch_id,sku),
  FOREIGN KEY(branch_id,sku) REFERENCES offline_stock(branch_id,sku));`);
 const {audit}=createDeviceRegistry(db,branchId),store=createSyncStore(db,{organizationId,branchId,installationId});
 function apply(snapshot,actor='administrator'){
  if(snapshot?.organizationId!==organizationId||snapshot.branchId!==branchId||!UUID.test(snapshot.warehouseId||'')||
   !Array.isArray(snapshot.products)||snapshot.products.length>5000)throw Error('INVALID_CATALOG_SNAPSHOT');
  const seen=new Set();
  for(const row of snapshot.products){
   if(!UUID.test(row.productId||'')||row.sku!==`p_${row.productId}_${snapshot.warehouseId}`||seen.has(row.sku)||
    !Number.isSafeInteger(row.quantity)||row.quantity<0||typeof row.name!=='string'||row.name.length>500||
    typeof row.unitName!=='string'||row.unitName.length<1||row.unitName.length>80||
    row.priceCommand?.sku!==row.sku||row.priceCommand.branch_id!==branchId||row.priceCommand.organization_id!==organizationId)
    throw Error('INVALID_CATALOG_PRODUCT');
   seen.add(row.sku);
  }
  db.exec('BEGIN IMMEDIATE');let seeded=0;
  try{
   for(const row of snapshot.products){
    const previous=db.prepare('SELECT * FROM offline_item_links WHERE branch_id=? AND sku=?').get(branchId,row.sku);
    if(previous&&(previous.product_id!==row.productId||previous.warehouse_id!==snapshot.warehouseId||previous.unit_name!==row.unitName))throw Error('CATALOG_LINK_CONFLICT');
    const stock=db.prepare('SELECT quantity FROM offline_stock WHERE branch_id=? AND sku=?').get(branchId,row.sku);
    if(stock&&!previous)throw Error('UNLINKED_LOCAL_SKU_CONFLICT');
    if(!stock){
     db.prepare('INSERT INTO offline_stock(branch_id,sku,quantity,unit_cost_minor) VALUES(?,?,?,0)').run(branchId,row.sku,row.quantity);seeded++;
     audit(actor,'stock.cloud_opening',row.sku,{quantity:row.quantity,warehouseId:snapshot.warehouseId});
    }
    db.prepare(`INSERT INTO offline_item_links(branch_id,sku,product_id,warehouse_id,unit_name,product_name) VALUES(?,?,?,?,?,?)
     ON CONFLICT(branch_id,sku) DO UPDATE SET product_name=excluded.product_name`).run(branchId,row.sku,row.productId,snapshot.warehouseId,row.unitName,row.name);
    const outcome=store.applyPrice(row.priceCommand);
    if(outcome==='conflict')throw Error('CATALOG_PRICE_CONFLICT');
   }
   audit(actor,'catalog.import',snapshot.warehouseId,{seeded,products:snapshot.products.length});
   db.exec('COMMIT');return {seeded,products:snapshot.products.length};
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 return {apply};
}
module.exports={createCatalogImporter};
