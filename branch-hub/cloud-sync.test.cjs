'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createOfflineSalesEngine}=require('./offline-sales.cjs');
const {createSyncStore,createCloudSync,hash}=require('./cloud-sync.cjs');
const {PROJECT_REF}=require('./cloud-client.cjs');
const scope={organizationId:'11111111-1111-4111-8111-111111111111',branchId:'22222222-2222-4222-8222-222222222222',installationId:'44444444-4444-4444-8444-444444444444'};
function create(){const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');const engine=createOfflineSalesEngine(db,scope.branchId);engine.setOpeningStock('coffee',5,100);return {db,engine};}
function price(revision=1,extra={}){return {id:crypto.randomUUID(),organization_id:scope.organizationId,branch_id:scope.branchId,sku:'coffee',revision,sale_price_minor:250,unit_cost_minor:120,...extra};}
test('versioned inbox changes future published cost without resetting local stock or rewriting historical sale costs',()=>{
 const {db,engine}=create();
 try{
  const sale=engine.commitSale({key:'before-price-001',lines:[{sku:'coffee',quantity:1,priceMinor:200}]});
  const store=createSyncStore(db,scope),command=price();
  assert.equal(store.applyPrice(command),'applied');assert.equal(store.applyPrice(command),'applied');
  assert.equal(db.prepare('SELECT quantity FROM offline_stock').get().quantity,4);
  assert.equal(db.prepare('SELECT cost_minor FROM offline_sale_lines WHERE sale_id=?').get(sale.saleId).cost_minor,100);
  assert.throws(()=>engine.commitSale({key:'stale-price-001',lines:[{sku:'coffee',quantity:1,priceMinor:200}]}),/PRICE_CHANGED/);
  engine.commitSale({key:'new-price-001',lines:[{sku:'coffee',quantity:1,priceMinor:250}]});
  assert.equal(db.prepare('SELECT sum(cost_minor) n FROM offline_sale_lines').get().n,220);
  assert.equal(store.applyPrice(price(1,{unit_cost_minor:999})),'conflict');
  assert.equal(store.applyPrice(price(2,{unit_cost_minor:0})),'applied');
  assert.equal(store.applyPrice(price(1)),'stale');
  assert.equal(db.prepare('SELECT unit_cost_minor FROM offline_stock').get().unit_cost_minor,0);
  assert.throws(()=>store.applyPrice({...command,unit_cost_minor:1}),/INBOX_IDEMPOTENCY_CONFLICT/);
  assert.throws(()=>store.applyPrice(price(3,{branch_id:scope.installationId})),/INVALID_CLOUD_COMMAND/);
 }finally{db.close();}
});
test('transport retries lost ACK once by cloud identity, commits inbox before ACK, and never marks financial events posted',async()=>{
 const {db,engine}=create();let sync;
 try{
  engine.commitSale({key:'sync-retry-sale-001',lines:[{sku:'coffee',quantity:1,priceMinor:250}]});
  const command=price();const remote=new Map();let loseSale=true,loseCommand=true,commandAck=false,persisted=0;
  const client={validateEnrollment:async()=>({}),request:async(route,{body}={})=>{
   if(route.startsWith('/auth/'))return {access_token:'cloud-access-token',refresh_token:'rotated-token',expires_in:3600};
   if(route.includes('receive_branch_hub_sale')){
    remote.set(body.p_event_id,body.p_payload_text);
    if(loseSale){loseSale=false;throw Error('NETWORK_LOST_AFTER_CLOUD_COMMIT');}
    return {stage:'received',eventId:body.p_event_id,payloadHash:hash(body.p_payload_text),projectRef:PROJECT_REF,...{organizationId:scope.organizationId,branchId:scope.branchId}};
   }
   if(route.includes('pull_branch_hub_prices'))return commandAck?[]:[command];
   if(route.includes('command_receipts')){
    assert.equal(db.prepare('SELECT outcome FROM cloud_price_inbox WHERE id=?').get(command.id).outcome,'applied');
    if(loseCommand){loseCommand=false;throw Error('COMMAND_ACK_LOST');}commandAck=true;return null;
   }
   throw Error('UNEXPECTED_ROUTE');
  }};
  sync=createCloudSync({db,client,...scope,refreshToken:'initial',persistRefreshToken:async()=>{persisted++;}});
  await assert.rejects(sync.run(),/NETWORK_LOST/);assert.equal(db.prepare('SELECT count(*) n FROM cloud_sale_receipts').get().n,0);
  await assert.rejects(sync.run(),/COMMAND_ACK_LOST/);assert.equal(db.prepare('SELECT count(*) n FROM cloud_price_inbox').get().n,1);
  await sync.run();assert.equal(remote.size,1);assert.equal(commandAck,true);assert.ok(persisted>=1);
  assert.equal(db.prepare("SELECT count(*) n FROM offline_outbox WHERE status='pending'").get().n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM hub_audit WHERE action='price.applied'").get().n,1);
  assert.equal(sync.status().canonicalPostingImplemented,false);
 }finally{if(sync)await sync.stop();db.close();}
});
test('unverified cloud ACK and failed durable credential rotation preserve pending outbox',async()=>{
 const {db,engine}=create();let sync;
 try{
  engine.commitSale({key:'bad-ack-sale-001',lines:[{sku:'coffee',quantity:1,priceMinor:250}]});
  const store=createSyncStore(db,scope),event=store.pending()[0];
  assert.throws(()=>store.acceptReceipt(event,{stage:'received',eventId:event.event_id,payloadHash:'forged',projectRef:PROJECT_REF,organizationId:scope.organizationId,branchId:scope.branchId}),/INVALID_CLOUD_ACKNOWLEDGEMENT/);
  let writes=0;
  const client={validateEnrollment:async()=>({}),request:async route=>{if(route.startsWith('/auth/'))return {access_token:'access',refresh_token:'rotated',expires_in:3600};writes++;}};
  sync=createCloudSync({db,client,...scope,refreshToken:'old',persistRefreshToken:async()=>{throw Error('DISK_WRITE_FAILED');}});
  await assert.rejects(sync.run(),/DISK_WRITE_FAILED/);assert.equal(writes,0);assert.equal(store.pending().length,1);
 }finally{if(sync)await sync.stop();db.close();}
});
