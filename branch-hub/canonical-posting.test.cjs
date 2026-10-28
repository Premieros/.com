'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createOfflineSalesEngine}=require('./offline-sales.cjs');
const {createSyncStore,createCloudSync,hash}=require('./cloud-sync.cjs');
const {createPostingStore}=require('./canonical-posting.cjs');
const {PROJECT_REF}=require('./cloud-client.cjs');
const scope={organizationId:'11111111-1111-4111-8111-111111111111',branchId:'22222222-2222-4222-8222-222222222222',installationId:'44444444-4444-4444-8444-444444444444'};
function setup(){const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');const engine=createOfflineSalesEngine(db,scope.branchId);engine.setOpeningStock('sku',5,100);engine.commitSale({key:'canonical-ack-001',lines:[{sku:'sku',quantity:2,priceMinor:250}]});const received=createSyncStore(db,scope),event=received.pending()[0],store=createPostingStore(db,scope);return {db,event,store};}
function ack(event){return {...scope,eventId:event.event_id,projectRef:PROJECT_REF,payloadHash:hash(event.payload),stage:'posted',canonicalSaleId:crypto.randomUUID(),canonicalJournalId:crypto.randomUUID(),totalMinor:500,costMinor:200};}
test('financial outbox acknowledgement requires a matching committed canonical sale and journal proof',()=>{
 const {db,event,store}=setup();
 try{
  const proof=ack(event);
  assert.throws(()=>store.accept(event,{...proof,canonicalJournalId:''}),/INVALID_CANONICAL/);
  assert.throws(()=>store.accept(event,{...proof,costMinor:201}),/INVALID_CANONICAL/);
  assert.throws(()=>store.accept(event,{...proof,installationId:scope.branchId}),/INVALID_CANONICAL/);
  assert.equal(db.prepare('SELECT status FROM offline_outbox').get().status,'pending');
  store.accept(event,{...proof,stage:'conflict',reason:'HUB_PRICE_CHANGED'});
  assert.equal(db.prepare('SELECT status FROM offline_outbox').get().status,'pending');
  assert.equal(store.accept(event,proof),true);assert.equal(store.accept(event,proof),true);
  assert.equal(db.prepare('SELECT status FROM offline_outbox').get().status,'acknowledged');
  assert.equal(db.prepare('SELECT count(*) n FROM cloud_posted_sales').get().n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM cloud_posting_errors').get().n,0);
  assert.throws(()=>store.accept(event,{...proof,canonicalSaleId:crypto.randomUUID()}),/ACKNOWLEDGEMENT_CONFLICT/);
 }finally{db.close();}
});
test('failure persisting a canonical proof rolls back both receipt and outbox status',()=>{
 const {db,event,store}=setup();
 try{
  db.exec("CREATE TRIGGER fail_post_audit BEFORE INSERT ON hub_audit WHEN NEW.action='sale.canonical_posted' BEGIN SELECT RAISE(ABORT,'injected IO error'); END");
  assert.throws(()=>store.accept(event,ack(event)),/injected IO/);
  assert.equal(db.prepare('SELECT status FROM offline_outbox').get().status,'pending');assert.equal(db.prepare('SELECT count(*) n FROM cloud_posted_sales').get().n,0);
 }finally{db.close();}
});
test('lost canonical response retries the same cloud sale and acknowledges locally once',async()=>{
 const {db,event}=setup();let sync;
 try{
  const product='66666666-6666-4666-8666-666666666666',warehouse='55555555-5555-4555-8555-555555555555';
  const payload=JSON.parse(event.payload);payload.lines[0].canonical={productId:product,warehouseId:warehouse,unitName:'piece'};
  event.payload=JSON.stringify(payload);db.prepare('UPDATE offline_outbox SET payload=?').run(event.payload);db.prepare('UPDATE offline_sale_lines SET canonical=?').run(JSON.stringify(payload.lines[0].canonical));
  const proof=ack(event);let cloudSales=0,lose=true;
  const client={validateEnrollment:async()=>({}),request:async(route)=>{
   if(route.startsWith('/auth/'))return {access_token:'access-token',refresh_token:'refresh-token',expires_in:3600};
   if(route.includes('receive_branch_hub_sale'))return {...proof,stage:'received'};
   if(route.includes('post_branch_hub_sale')){if(!cloudSales)cloudSales++;if(lose){lose=false;throw Error('ACK_LOST_AFTER_POST');}return proof;}
   if(route.includes('pull_branch_hub_prices'))return [];
   throw Error('UNEXPECTED_ROUTE');
  }};
  sync=createCloudSync({db,client,...scope,refreshToken:'initial',persistRefreshToken:async()=>{}});
  await assert.rejects(sync.run(),/ACK_LOST/);assert.equal(db.prepare('SELECT status FROM offline_outbox').get().status,'pending');
  await sync.run();await sync.run();assert.equal(cloudSales,1);
  assert.equal(db.prepare('SELECT status FROM offline_outbox').get().status,'acknowledged');
  assert.equal(sync.status().postedSales,1);
 }finally{if(sync)await sync.stop();db.close();}
});
