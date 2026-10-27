'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createOfflineSalesEngine}=require('./offline-sales.cjs');
test('offline sale deducts stock, balances journals, queues one sync event',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const engine=createOfflineSalesEngine(db,'branch_001');
  engine.setOpeningStock('coffee',10,120);
  const input={key:'checkout-00001',lines:[{sku:'coffee',quantity:2,priceMinor:300}]};
  const first=engine.commitSale(input);
  assert.equal(first.totalMinor,600);
  assert.equal(engine.commitSale(input).duplicate,true);
  assert.equal(db.prepare("SELECT quantity FROM offline_stock WHERE sku='coffee'").get().quantity,8);
  const journal=db.prepare('SELECT SUM(debit_minor) AS dr,SUM(credit_minor) AS cr FROM offline_journal').get();
  assert.equal(journal.dr,840);assert.equal(journal.cr,840);
  assert.equal(db.prepare('SELECT count(*) AS n FROM offline_outbox').get().n,1);
  const movements=db.prepare('SELECT delta,balance_after FROM offline_stock_movements').all();
  assert.deepEqual(movements.map(({delta,balance_after})=>({delta,balance_after})),[{delta:-2,balance_after:8}]);
  assert.throws(()=>engine.commitSale({...input,lines:[{sku:'coffee',quantity:1,priceMinor:300}]}),/IDEMPOTENCY_CONFLICT/);
  assert.throws(()=>engine.commitSale({key:'checkout-00002',lines:[{sku:'coffee',quantity:100,priceMinor:300}]}),/INSUFFICIENT_STOCK/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM offline_sales').get().n,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM offline_stock_movements').get().n,1);
  assert.equal(db.prepare('SELECT quantity FROM offline_stock').get().quantity,8);
 }finally{db.close();}
});
test('separate branch inventory cannot be consumed',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  createOfflineSalesEngine(db,'branch_A').setOpeningStock('sku1',3,5);
  const other=createOfflineSalesEngine(db,'branch_B');
  assert.throws(()=>other.commitSale({key:'sale-12345678',lines:[{sku:'sku1',quantity:1,priceMinor:10}]}),/INSUFFICIENT_STOCK/);
 }finally{db.close();}
});

test('failure after stock debit rolls back sale, movement, ledger, audit and outbox',()=>{
 const db=new DatabaseSync(':memory:');
 try {
  const engine=createOfflineSalesEngine(db,'branch_001');
  engine.setOpeningStock('sku',4,10);
  db.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON offline_outbox BEGIN SELECT RAISE(ABORT,'injected disk write failure'); END");
  assert.throws(()=>engine.commitSale({key:'rollback-sale-001',lines:[{sku:'sku',quantity:1,priceMinor:25}]}),/injected/);
  assert.equal(db.prepare('SELECT quantity FROM offline_stock').get().quantity,4);
  for(const table of ['offline_sales','offline_sale_lines','offline_journal','offline_stock_movements','offline_outbox'])
    assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM hub_audit WHERE action='sale.commit'").get().n,0);
 } finally {db.close();}
});

test('accounting audit rejects balanced but incorrect financial postings and altered sync payloads',()=>{
 const {auditOfflineSales}=require('./integrity.cjs');
 const db=new DatabaseSync(':memory:');
 try {
  const engine=createOfflineSalesEngine(db,'branch_001');engine.setOpeningStock('sku',3,10);
  engine.commitSale({key:'posting-audit-001',lines:[{sku:'sku',quantity:1,priceMinor:100}]});
  assert.equal(auditOfflineSales(db,'branch_001').invalidPostings,0);
  db.exec("UPDATE offline_journal SET debit_minor=debit_minor+5 WHERE account='cash'; UPDATE offline_journal SET credit_minor=credit_minor+5 WHERE account='sales_revenue'");
  const audit=auditOfflineSales(db,'branch_001');assert.equal(audit.unbalanced,0);assert.equal(audit.invalidPostings,1);
  db.exec("UPDATE offline_outbox SET payload='{}'");assert.equal(auditOfflineSales(db,'branch_001').invalidEvents,1);
 }finally{db.close();}
});
