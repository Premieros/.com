'use strict';
// Offline disaster recovery into a fresh, empty per-branch data directory.
// Never replace a running or pre-existing database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const { validateRecoveryDatabase } = require('./recovery-validation.cjs');
function validateBackup(source, organizationId, branchId) {
  // Recovery accepts standalone snapshots, never a live WAL database with uncheckpointed data.
  if (fs.existsSync(source + '-wal') && fs.statSync(source + '-wal').size > 0)
    throw Error('BACKUP_HAS_ACTIVE_WAL');
  const db = new DatabaseSync(source, { readOnly: true });
  try { return validateRecoveryDatabase(db, organizationId, branchId); }
  finally { db.close(); }
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
  validateBackup(source, organizationId, branchId);
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const destination = path.join(targetDir, 'branch-hub.sqlite');
  const temporary = path.join(targetDir, '.restore-' + crypto.randomUUID() + '.sqlite');
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temporary, 0o600);
    const summary = validateBackup(temporary, organizationId, branchId);
    const fd = fs.openSync(temporary, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
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
