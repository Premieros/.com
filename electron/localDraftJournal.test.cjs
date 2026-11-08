'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes,createCipheriv,createDecipheriv } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { openLocalDraftJournal, TYPES } = require('./localDraftJournal.cjs');

function codec() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm',key,nonce);
      const encrypted = Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
      return Buffer.concat([nonce,cipher.getAuthTag(),encrypted]);
    },
    decryptString(buffer) {
      const nonce = buffer.subarray(0,12), tag = buffer.subarray(12,28);
      const decipher = createDecipheriv('aes-256-gcm',key,nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(buffer.subarray(28)),decipher.final()]).toString('utf8');
    },
  };
}
function fixture(overrides={}) {
  return {
    orgId:'org-1',branchId:'branch-a',operatorId:'cashier-1',
    deviceId:'device-1',warehouseId:'warehouse-a',kind:'sale',
    documentKey:'INV-OFF-01',operationKey:'device:operation-01',
    payload:{amount:123.45,customer:'private-customer',items:[{sku:'tea',quantity:2}]},
    ...overrides,
  };
}
async function sandbox(fn) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'premier-journal-'));
  const filename=path.join(folder,'local.sqlite');
  try { await fn({filename,folder}); }
  finally { fs.rmSync(folder,{recursive:true,force:true}); }
}

test('OS encryption is mandatory and no plaintext fallback is permitted',async()=>{
  await sandbox(async ({filename})=>{
    assert.throws(()=>openLocalDraftJournal({filename}),/ENCRYPTION_REQUIRED/);
    assert.throws(()=>openLocalDraftJournal({filename,codec:{
      isEncryptionAvailable:()=>false,encryptString:()=>Buffer.from('no'),
      decryptString:()=>''}}),/ENCRYPTION_REQUIRED/);
    assert.equal(fs.existsSync(filename),false);
  });
});
test('all local draft families are defined but none is posted',()=>{
  assert.deepEqual(TYPES,['sale','return','hold_order','kitchen_ticket',
    'purchase_receipt','stock_movement','manufacture','expense','journal_draft']);
});
test('a drafted sale is encrypted, tenant/branch/operator scoped and remains PENDING',async()=>{
  await sandbox(async ({filename})=>{
    const c=codec(), journal=openLocalDraftJournal({filename,codec:c});
    const a=journal.stage(fixture());
    assert.equal(a.state,'LOCAL_PENDING');
    assert.equal(a.replayed,false);
    assert.equal(a.sequence,1);
    assert.deepEqual(journal.list({
      orgId:'org-1',branchId:'branch-a',operatorId:'cashier-1'
    }).map(x=>x.localId),[a.localId]);
    assert.deepEqual(journal.list({
      orgId:'org-1',branchId:'branch-b',operatorId:'cashier-1'
    }),[]);
    assert.equal(journal.get({orgId:'org-1',branchId:'branch-a',
      operatorId:'intruder',localId:a.localId}),null);
    const draft=journal.get({orgId:'org-1',branchId:'branch-a',
      operatorId:'cashier-1',localId:a.localId});
    assert.equal(draft.payload.customer,'private-customer');
    assert.equal(journal.verifyIntegrity().verifiedDrafts,1);
    journal.close();
    const disk=fs.readFileSync(filename);
    assert.equal(disk.includes('private-customer'),false);
    assert.equal(disk.includes('INV-OFF-01'),false);
  });
});
test('restart preserves documents and identical retry cannot create a second draft',async()=>{
  await sandbox(async ({filename})=>{
    const c=codec();
    let journal=openLocalDraftJournal({filename,codec:c});
    const first=journal.stage(fixture());
    journal.close();
    journal=openLocalDraftJournal({filename,codec:c});
    assert.deepEqual(journal.stage(fixture()),{...first,replayed:true});
    assert.equal(journal.list({orgId:'org-1',branchId:'branch-a',
      operatorId:'cashier-1'}).length,1);
    const second=journal.stage(fixture({documentKey:'INV-OFF-02',
      operationKey:'device:operation-02'}));
    assert.equal(second.sequence,2);
    assert.equal(journal.verifyIntegrity().verifiedDrafts,2);
    journal.close();
  });
});
test('same invoice or idempotency key with changed content is rejected',async()=>{
  await sandbox(async ({filename})=>{
    const journal=openLocalDraftJournal({filename,codec:codec()});
    journal.stage(fixture());
    assert.throws(()=>journal.stage(fixture({payload:{amount:999}})),/KEY_CONFLICT/);
    assert.throws(()=>journal.stage(fixture({operationKey:'other'})),/KEY_CONFLICT/);
    assert.throws(()=>journal.stage(fixture({documentKey:'other'})),/KEY_CONFLICT/);
    assert.throws(()=>journal.stage(fixture({operatorId:'cashier-2'})),/KEY_CONFLICT/);
    assert.equal(journal.verifyIntegrity().verifiedDrafts,1);
    journal.close();
  });
});
test('other branches are isolated but stock-affecting drafts require warehouse scope',async()=>{
  await sandbox(async ({filename})=>{
    const journal=openLocalDraftJournal({filename,codec:codec()});
    journal.stage(fixture());
    const other=journal.stage(fixture({branchId:'branch-b',warehouseId:'warehouse-b'}));
    assert.equal(other.sequence,2);
    assert.throws(()=>journal.stage(fixture({documentKey:'new',
      operationKey:'new',warehouseId:null})),/WAREHOUSE_REQUIRED/);
    assert.throws(()=>journal.stage(fixture({documentKey:'new',
      operationKey:'new',kind:'unsupported'})),/KIND_UNSUPPORTED/);
    assert.equal(journal.verifyIntegrity().verifiedDrafts,2);
    journal.close();
  });
});
test('encryption/validation errors do not save partial financial documents',async()=>{
  await sandbox(async ({filename})=>{
    const c=codec(), original=c.encryptString;
    c.encryptString=()=>{throw new Error('SIMULATED_CRYPTO_FAILURE');};
    const journal=openLocalDraftJournal({filename,codec:c});
    assert.throws(()=>journal.stage(fixture()),/SIMULATED_CRYPTO_FAILURE/);
    c.encryptString=original;
    assert.equal(journal.verifyIntegrity().verifiedDrafts,0);
    journal.close();
  });
});
test('review queue is durable but cannot be declared posted by local API',async()=>{
  await sandbox(async ({filename})=>{
    const c=codec(), journal=openLocalDraftJournal({filename,codec:c});
    const result=journal.stage(fixture());
    assert.equal(journal.flagReview({orgId:'org-1',branchId:'branch-b',
      operatorId:'cashier-1',localId:result.localId}),false);
    assert.equal(journal.flagReview({orgId:'org-1',branchId:'branch-a',
      operatorId:'cashier-1',localId:result.localId}),true);
    assert.equal(journal.get({orgId:'org-1',branchId:'branch-a',
      operatorId:'cashier-1',localId:result.localId}).state,'NEEDS_REVIEW');
    journal.close();
    const again=openLocalDraftJournal({filename,codec:c});
    assert.equal(again.list({orgId:'org-1',branchId:'branch-a',
      operatorId:'cashier-1'})[0].state,'NEEDS_REVIEW');
    again.close();
  });
});
test('corrupted encrypted payload cannot be silently accepted at recovery',async()=>{
  await sandbox(async ({filename})=>{
    const c=codec(), journal=openLocalDraftJournal({filename,codec:c});
    journal.stage(fixture());
    journal.close();
    const db=new DatabaseSync(filename);
    db.exec("UPDATE local_drafts SET encrypted_payload=X'01020304'");
    db.close();
    const reopened=openLocalDraftJournal({filename,codec:c});
    assert.throws(()=>reopened.verifyIntegrity());
    reopened.close();
  });
});
