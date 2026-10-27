'use strict';
// Offline disaster recovery into a fresh, empty per-branch data directory.
// Never replace a running or pre-existing database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function validateBackup(source, organizationId, branchId) {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    const check = db.prepare('PRAGMA integrity_check').all();
    if (check.length !== 1 || check[0].integrity_check !== 'ok') throw Error('BACKUP_INTEGRITY_FAILED');
    const binding = db.prepare('SELECT organization_id, branch_id FROM hub_identity WHERE singleton=1').get();
    if (!binding || binding.organization_id !== organizationId || binding.branch_id !== branchId)
      throw Error('BACKUP_BRANCH_BINDING_MISMATCH');
    for (const table of ['local_receipts', 'sync_outbox', 'jobs']) {
      const found = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!found) throw Error('BACKUP_MISSING_TABLE: ' + table);
    }
    return {
      receipts: db.prepare('SELECT count(*) AS n FROM local_receipts').get().n,
      pending: db.prepare("SELECT count(*) AS n FROM sync_outbox WHERE status='pending'").get().n,
    };
  } finally { db.close(); }
}

function restoreToEmptyDirectory({ backupPath, dataDir, organizationId, branchId }) {
  if (!backupPath || !dataDir || !organizationId || !branchId) throw Error('RESTORE_ARGUMENTS_REQUIRED');
  const source = path.resolve(backupPath), targetDir = path.resolve(dataDir);
  const sourceStat = fs.lstatSync(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw Error('BACKUP_MUST_BE_REGULAR_FILE');
  if (fs.existsSync(targetDir)) {
    if (!fs.lstatSync(targetDir).isDirectory() || fs.lstatSync(targetDir).isSymbolicLink())
      throw Error('INVALID_TARGET_DIRECTORY');
    if (fs.readdirSync(targetDir).length !== 0) throw Error('RESTORE_TARGET_NOT_EMPTY');
  }
  const summary = validateBackup(source, organizationId, branchId);
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const destination = path.join(targetDir, 'branch-hub.sqlite');
  const temporary = path.join(targetDir, '.restore-' + crypto.randomUUID() + '.sqlite');
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temporary, 0o600);
    validateBackup(temporary, organizationId, branchId);
    // Exclusive create prevents accidentally replacing an existing DB.
    fs.copyFileSync(temporary, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, 0o600);
    return { destination, ...summary };
  } finally { fs.rmSync(temporary, { force: true }); }
}

if (require.main === module) {
  // Usage: node restore.cjs <snapshot.sqlite> <EMPTY-data-directory> <organization-id> <branch-id>
  try {
    const [backupPath, dataDir, organizationId, branchId] = process.argv.slice(2);
    const result = restoreToEmptyDirectory({ backupPath, dataDir, organizationId, branchId });
    console.log(JSON.stringify({ ok: true, ...result }));
  } catch (error) {
    console.error('RESTORE_FAILED:', error.message);
    process.exitCode = 1;
  }
}
module.exports = { validateBackup, restoreToEmptyDirectory };
