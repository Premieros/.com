'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { restoreToEmptyDirectory } = require('./restore.cjs');

test('restore preserves all pending events and branch binding, never overwrites existing data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-restore-'));
  try {
    const original = path.join(root, 'snapshot.sqlite');
    const db = new DatabaseSync(original);
    db.exec("CREATE TABLE hub_identity(singleton INTEGER PRIMARY KEY, organization_id TEXT, branch_id TEXT); INSERT INTO hub_identity VALUES(1,'org_001','branch_001');");
    db.exec("CREATE TABLE local_receipts(id TEXT); INSERT INTO local_receipts VALUES('r1');");
    db.exec("CREATE TABLE sync_outbox(status TEXT); INSERT INTO sync_outbox VALUES('pending');");
    db.exec("CREATE TABLE jobs(id TEXT); INSERT INTO jobs VALUES('j1');");
    db.close();
    const destination = path.join(root, 'fresh');
    assert.throws(() => restoreToEmptyDirectory({ backupPath:original, dataDir:destination, organizationId:'org_wrong', branchId:'branch_001' }), /BACKUP_BRANCH_BINDING_MISMATCH/);
    assert.equal(fs.existsSync(destination), false);
    const result = restoreToEmptyDirectory({ backupPath:original, dataDir:destination, organizationId:'org_001', branchId:'branch_001' });
    assert.equal(result.receipts, 1);
    assert.equal(result.pending, 1);
    const restored = new DatabaseSync(result.destination, { readOnly:true });
    try { assert.equal(restored.prepare('SELECT branch_id FROM hub_identity').get().branch_id, 'branch_001'); }
    finally { restored.close(); }
    assert.throws(() => restoreToEmptyDirectory({ backupPath:original, dataDir:destination, organizationId:'org_001', branchId:'branch_001' }), /RESTORE_TARGET_NOT_EMPTY/);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
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
