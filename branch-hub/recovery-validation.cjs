'use strict';
// Shared by backup creation and restore: SQLite integrity alone cannot detect lost ledger rows.
function validateRecoveryDatabase(db, organizationId, branchId) {
  const check = db.prepare('PRAGMA integrity_check').all();
  if (check.length !== 1 || check[0].integrity_check !== 'ok') throw Error('BACKUP_INTEGRITY_FAILED');
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw Error('BACKUP_FOREIGN_KEY_FAILED');
  const identity = db.prepare('SELECT organization_id,branch_id FROM hub_identity WHERE singleton=1').get();
  if (identity?.organization_id !== organizationId || identity?.branch_id !== branchId)
    throw Error('BACKUP_BRANCH_BINDING_MISMATCH');
  const required = ['local_receipts','sync_outbox','jobs','offline_stock','offline_sales',
    'offline_sale_lines','offline_journal','offline_stock_movements','offline_outbox'];
  for (const table of required) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))
      throw Error('BACKUP_MISSING_TABLE: ' + table);
    if (table !== 'offline_sale_lines' && table !== 'offline_journal' &&
        db.prepare(`SELECT 1 FROM ${table} WHERE branch_id != ? LIMIT 1`).get(branchId))
      throw Error('BACKUP_CROSS_BRANCH_DATA');
  }
  const missing = db.prepare(`SELECT count(*) n FROM offline_sales s
    LEFT JOIN offline_outbox o ON o.sale_id=s.id AND o.branch_id=s.branch_id
    WHERE o.event_id IS NULL`).get().n;
  const unbalanced = db.prepare(`SELECT count(*) n FROM (SELECT s.id FROM offline_sales s
    LEFT JOIN offline_journal j ON j.sale_id=s.id GROUP BY s.id
    HAVING count(j.sale_id)=0 OR sum(j.debit_minor)!=sum(j.credit_minor))`).get().n;
  const missingLines = db.prepare(`SELECT count(*) n FROM offline_sales s WHERE NOT EXISTS
    (SELECT 1 FROM offline_sale_lines l WHERE l.sale_id=s.id)`).get().n;
  const movements = db.prepare(`SELECT count(*) n FROM offline_sale_lines l
    JOIN offline_sales s ON s.id=l.sale_id LEFT JOIN offline_stock_movements m
    ON m.sale_id=s.id AND m.sku=l.sku AND m.branch_id=s.branch_id
    WHERE m.id IS NULL OR m.delta != -l.quantity`).get().n;
  const receipts = db.prepare(`SELECT count(*) n FROM local_receipts r LEFT JOIN sync_outbox o
    ON o.entity_id=r.id AND o.branch_id=r.branch_id WHERE o.event_id IS NULL`).get().n;
  if (missing || unbalanced || missingLines || movements || receipts) throw Error('BACKUP_ACCOUNTING_INTEGRITY_FAILED');
  return {
    receipts: db.prepare('SELECT count(*) n FROM local_receipts').get().n,
    pending: db.prepare("SELECT count(*) n FROM sync_outbox WHERE status='pending'").get().n,
    offlineSales: db.prepare('SELECT count(*) n FROM offline_sales').get().n,
    offlinePending: db.prepare("SELECT count(*) n FROM offline_outbox WHERE status='pending'").get().n,
  };
}
module.exports = { validateRecoveryDatabase };
