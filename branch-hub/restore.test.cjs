'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createHub } = require('./server.cjs');
const { createOfflineSalesEngine } = require('./offline-sales.cjs');
const { restoreToEmptyDirectory } = require('./restore.cjs');

test('restore preserves sale, journal, stock and outbox; refuses accounting damage', async () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'branch-restore-'));
 const config={dataDir:path.join(root,'source'),organizationId:'org_001',branchId:'branch_001',token:'a'.repeat(40),port:0};
 const hub=createHub(config);
 let original;
 try {
  await hub.listen();
  const engine=createOfflineSalesEngine(hub.db,'branch_001');
  engine.setOpeningStock('sku',10,50);
  engine.commitSale({key:'restore-sale-001',lines:[{sku:'sku',quantity:2,priceMinor:100}]});
  original=path.join(config.dataDir,'backups',hub.createLocalBackup().filename);
 } finally { await hub.close(); }
 try {
  const args={backupPath:original,dataDir:path.join(root,'fresh'),organizationId:'org_001',branchId:'branch_001'};
  assert.throws(()=>restoreToEmptyDirectory({...args,organizationId:'other_org'}),/BINDING_MISMATCH/);
  const result=restoreToEmptyDirectory(args);
  assert.equal(result.offlineSales,1);assert.equal(result.offlinePending,1);
  const db=new DatabaseSync(result.destination);
  try {
   assert.equal(db.prepare('SELECT quantity FROM offline_stock').get().quantity,8);
   assert.equal(db.prepare('SELECT sum(debit_minor)-sum(credit_minor) n FROM offline_journal').get().n,0);
  } finally {db.close();}
  assert.throws(()=>restoreToEmptyDirectory(args),/NOT_EMPTY/);
  const damaged=path.join(root,'damaged.sqlite');fs.copyFileSync(original,damaged);
  const bad=new DatabaseSync(damaged);
  bad.exec('DELETE FROM offline_outbox');bad.close();
  assert.throws(()=>restoreToEmptyDirectory({...args,backupPath:damaged,dataDir:path.join(root,'bad-target')}),/ACCOUNTING_INTEGRITY_FAILED/);
  assert.equal(fs.existsSync(path.join(root,'bad-target')),false);
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('corrupt database cannot be restored', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'branch-invalid-'));
  try {
    const corrupt=path.join(root,'corrupt.sqlite');
    fs.writeFileSync(corrupt,'not a SQLite database');
    assert.throws(()=>restoreToEmptyDirectory({backupPath:corrupt,dataDir:path.join(root,'target'),organizationId:'org_001',branchId:'branch_001'}));
    assert.equal(fs.existsSync(path.join(root,'target')),false);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('restore rejects a snapshot missing print delivery history rather than risking duplicate receipts',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-print-restore-'));
 const hub=createHub({port:0,dataDir:path.join(root,'source'),organizationId:'org_001',branchId:'branch_001',token:'t'.repeat(40)});
 try {
  await hub.listen();
  const file=path.join(root,'source','backups',hub.createLocalBackup().filename);
  const db=new DatabaseSync(file);db.exec('DROP TABLE print_dispatches');db.close();
  assert.throws(()=>restoreToEmptyDirectory({backupPath:file,dataDir:path.join(root,'restored'),organizationId:'org_001',branchId:'branch_001'}),/BACKUP_MISSING_TABLE: print_dispatches/);
 }finally{await hub.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('recovery refuses an acknowledged financial outbox without its canonical proof',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-proof-restore-'));
 const hub=createHub({port:0,dataDir:path.join(root,'source'),organizationId:'org_001',branchId:'branch_001',token:'t'.repeat(40)});
 try{
  await hub.listen();const engine=createOfflineSalesEngine(hub.db,'branch_001');
  engine.setOpeningStock('sku',3,50);engine.commitSale({key:'proof-restore-001',lines:[{sku:'sku',quantity:1,priceMinor:100}]});
  const file=path.join(root,'source','backups',hub.createLocalBackup().filename);
  const db=new DatabaseSync(file);db.exec("UPDATE offline_outbox SET status='acknowledged'");db.close();
  assert.throws(()=>restoreToEmptyDirectory({backupPath:file,dataDir:path.join(root,'restored'),organizationId:'org_001',branchId:'branch_001'}),/BACKUP_CANONICAL_PROOF_MISMATCH/);
 }finally{await hub.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('v3 backups restore read-only and upgrade to v4 without losing pending sales',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-v3-restore-'));
 const config={port:0,dataDir:path.join(root,'source'),organizationId:'org_001',branchId:'branch_001',token:'t'.repeat(40)};
 const hub=createHub(config);let upgraded;
 try{
  await hub.listen();const engine=createOfflineSalesEngine(hub.db,config.branchId);
  engine.setOpeningStock('sku',3,50);engine.commitSale({key:'legacy-v3-sale-001',lines:[{sku:'sku',quantity:1,priceMinor:100}]});
  const file=path.join(config.dataDir,'backups',hub.createLocalBackup().filename);
  const db=new DatabaseSync(file);
  db.exec('ALTER TABLE offline_sale_lines DROP COLUMN canonical; DROP TABLE offline_item_links; DROP TABLE cloud_posted_sales; DROP TABLE cloud_posting_errors; PRAGMA user_version=3');db.close();
  const dataDir=path.join(root,'restored');const restored=restoreToEmptyDirectory({backupPath:file,dataDir,organizationId:config.organizationId,branchId:config.branchId});
  assert.equal(restored.offlineSales,1);assert.equal(restored.offlinePending,1);
  const source=new DatabaseSync(file,{readOnly:true});assert.equal(source.prepare('PRAGMA user_version').get().user_version,3);source.close();
  upgraded=createHub({...config,dataDir});await upgraded.listen();
  assert.equal(upgraded.db.prepare('PRAGMA user_version').get().user_version,4);
  assert.equal(upgraded.db.prepare('SELECT quantity FROM offline_stock').get().quantity,2);
  assert.equal(upgraded.db.prepare('SELECT status FROM offline_outbox').get().status,'pending');
  upgraded.createLocalBackup();
 }finally{if(upgraded)await upgraded.close();await hub.close();fs.rmSync(root,{recursive:true,force:true});}
});
