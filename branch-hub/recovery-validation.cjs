'use strict';
const {auditOfflineSales}=require('./integrity.cjs');
// Shared by backup creation and restore: SQLite integrity alone cannot detect lost ledger rows.
function validateRecoveryDatabase(db, organizationId, branchId) {
  const check = db.prepare('PRAGMA integrity_check').all();
  if (check.length !== 1 || check[0].integrity_check !== 'ok') throw Error('BACKUP_INTEGRITY_FAILED');
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw Error('BACKUP_FOREIGN_KEY_FAILED');
  const identity = db.prepare('SELECT organization_id,branch_id FROM hub_identity WHERE singleton=1').get();
  if (identity?.organization_id !== organizationId || identity?.branch_id !== branchId)
    throw Error('BACKUP_BRANCH_BINDING_MISMATCH');
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version>4)throw Error('BACKUP_UNSUPPORTED_VERSION');
  const required = ['local_receipts','sync_outbox','jobs','offline_stock','offline_sales',
    'offline_sale_lines','offline_journal','offline_stock_movements','offline_outbox'];
  if(version>=1)required.push('hub_devices','hub_audit','print_dispatches');
  if(version>=2)required.push('offline_catalog','cloud_sale_receipts','cloud_price_inbox');
  if(version>=4)required.push('offline_item_links','cloud_posted_sales','cloud_posting_errors');
  for (const table of required) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))
      throw Error('BACKUP_MISSING_TABLE: ' + table);
    if (table !== 'offline_sale_lines' && table !== 'offline_journal' && table !== 'print_dispatches' &&
        db.prepare(`SELECT 1 FROM ${table} WHERE branch_id != ? LIMIT 1`).get(branchId))
      throw Error('BACKUP_CROSS_BRANCH_DATA');
  }
  if(version>=3 && !db.prepare('PRAGMA table_info(hub_identity)').all().some(c=>c.name==='installation_id'))throw Error('BACKUP_MISSING_INSTALLATION_BINDING');
  if(version>=4&&!db.prepare('PRAGMA table_info(offline_sale_lines)').all().some(c=>c.name==='canonical'))throw Error('BACKUP_MISSING_ITEM_LINK_SNAPSHOT');
  if(version>=4){
    const inconsistent=db.prepare(`SELECT count(*) n FROM offline_outbox o
      LEFT JOIN cloud_posted_sales p ON p.event_id=o.event_id
      WHERE o.branch_id=? AND ((o.status='acknowledged') != (p.event_id IS NOT NULL)
       OR (p.event_id IS NOT NULL AND (p.branch_id!=o.branch_id
         OR p.total_minor!=json_extract(o.payload,'$.totalMinor')
         OR p.cost_minor!=(SELECT sum(json_extract(value,'$.costMinor')) FROM json_each(o.payload,'$.lines')))))`).get(branchId).n;
    if(inconsistent)throw Error('BACKUP_CANONICAL_PROOF_MISMATCH');
    const crypto=require('node:crypto');
    for(const proof of db.prepare(`SELECT p.payload_hash,o.payload FROM cloud_posted_sales p
      JOIN offline_outbox o ON o.event_id=p.event_id WHERE p.branch_id=?`).all(branchId)){
      if(crypto.createHash('sha256').update(proof.payload).digest('hex')!==proof.payload_hash)
        throw Error('BACKUP_CANONICAL_PROOF_MISMATCH');
    }
  }
  const audit=auditOfflineSales(db,branchId);
  const receipts = db.prepare(`SELECT count(*) n FROM local_receipts r LEFT JOIN sync_outbox o
    ON o.entity_id=r.id AND o.branch_id=r.branch_id WHERE o.event_id IS NULL`).get().n;
  if (Object.values(audit).some(n=>n!==0) || receipts) throw Error('BACKUP_ACCOUNTING_INTEGRITY_FAILED');
  return {
    receipts: db.prepare('SELECT count(*) n FROM local_receipts').get().n,
    pending: db.prepare("SELECT count(*) n FROM sync_outbox WHERE status='pending'").get().n,
    offlineSales: db.prepare('SELECT count(*) n FROM offline_sales').get().n,
    offlinePending: db.prepare("SELECT count(*) n FROM offline_outbox WHERE status='pending'").get().n,
  };
}
module.exports = { validateRecoveryDatabase };
