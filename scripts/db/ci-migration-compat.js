import { createHash } from 'node:crypto';
import { basename } from 'node:path';

// CI-only replay of ONE known historical syntax typo. Never change the
// historical migration file (its original checksum is locked on production).
const HISTORICAL_FILE = '20261023150600_raw_published_price_asof_helper.sql';
const HISTORICAL_GIT_BLOB_SHA1 = '81de1ccf1708df17331b34114e00288b384d4560';
const BROKEN_TAIL = '$function$\n\nREVOKE ALL ON FUNCTION private.raw_published_unit_cost_at_v2';
const HISTORICAL_RECONCILE_FILE = '20261023172500_reconcile_nine_verified_raw_branch_balance_cache_rows.sql';
const HISTORICAL_RECONCILE_BLOB_SHA1 = '7cf2b39ae968824836757db377305ab141030b37';
const EMPTY_CI_RECONCILIATION = `-- CI-only replay: this historical migration repaired exactly nine production
-- cached inventory rows. A newly created disposable CI database has none.
-- Refuse to skip if any inventory evidence exists: never bypass a real repair.
DO $ci_empty_inventory$
BEGIN
  IF EXISTS (SELECT 1 FROM public.raw_material_inventory LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.raw_material_batches LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.inventory_ledger LIMIT 1) THEN
    RAISE EXCEPTION 'CI_RECONCILIATION_NOT_EMPTY';
  END IF;
END
$ci_empty_inventory$;`;

const FIXED_TAIL = '$function$;\n\nREVOKE ALL ON FUNCTION private.raw_published_unit_cost_at_v2';

export function normalizeHistoricalMigrationForCi(filePath, sql) {
  const filename = basename(filePath);
  if (filename !== HISTORICAL_FILE && filename !== HISTORICAL_RECONCILE_FILE) return sql;

  const bytes = Buffer.byteLength(sql, 'utf8');
  const blobSha1 = createHash('sha1')
    .update('blob ' + bytes + '\0')
    .update(sql, 'utf8')
    .digest('hex');

  if (filename === HISTORICAL_RECONCILE_FILE) {
    if (blobSha1 !== HISTORICAL_RECONCILE_BLOB_SHA1) {
      throw new Error('CI_RECONCILIATION_CONTENT_DRIFT');
    }
    return EMPTY_CI_RECONCILIATION;
  }

  if (blobSha1 !== HISTORICAL_GIT_BLOB_SHA1) {
    throw new Error('CI_HISTORICAL_MIGRATION_CONTENT_DRIFT');
  }
  if (sql.split(BROKEN_TAIL).length !== 2) {
    throw new Error('CI_HISTORICAL_MIGRATION_ANCHOR_DRIFT');
  }
  return sql.replace(BROKEN_TAIL, FIXED_TAIL);
}

export function assertCiReplayOnly({ env, databaseUrl }) {
  if (env.CI !== 'true') {
    throw new Error('CI_HISTORICAL_REPLAY_REQUIRES_CI');
  }
  let hostname;
  try { hostname = new URL(databaseUrl).hostname; }
  catch { throw new Error('CI_HISTORICAL_REPLAY_INVALID_DATABASE_URL'); }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
    throw new Error('CI_HISTORICAL_REPLAY_LOCAL_DATABASE_ONLY');
  }
}
