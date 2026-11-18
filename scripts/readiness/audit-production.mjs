#!/usr/bin/env node
// Run manually only. Aggregate-only, read-only production health snapshot.
// SUPABASE_PROJECT_REF=... SUPABASE_DB_URL=... node scripts/readiness/audit-production.mjs --confirm-project=...
import { fileURLToPath } from 'node:url';

export const READINESS_QUERIES = {
  schema: [
    "select",
    "(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) as unprotected_tables,",
    "(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and has_table_privilege('anon',c.oid,'SELECT')) as anon_readable_tables"
  ].join(' '),
  integrity: [
    "select",
    "(select count(*) from public.sale_items i left join public.sales s on s.id=i.sale_id where s.id is null) as orphan_items,",
    "(select count(*) from public.sale_payments p left join public.sales s on s.id=p.sale_id where s.id is null) as orphan_payments,",
    "(select count(*) from public.journal_entry_lines l left join public.journal_entries j on j.id=l.journal_entry_id where j.id is null) as orphan_lines,",
    "(select count(*) from (select branch_id,invoice_number from public.sales where invoice_number is not null group by 1,2 having count(*)>1) d) as duplicate_invoices"
  ].join(' '),
  accounting: [
    "with sums as (select e.id,e.posting_status,coalesce(sum(l.debit),0) dr,coalesce(sum(l.credit),0) cr,count(l.id) lines",
    "from public.journal_entries e left join public.journal_entry_lines l on l.journal_entry_id=e.id",
    "group by e.id,e.posting_status) select",
    "count(*) filter(where abs(dr-cr)>0.005) as unbalanced,",
    "count(*) filter(where posting_status='posted' and abs(dr-cr)>0.005) as unbalanced_posted,",
    "count(*) filter(where lines=0) as empty_entries from sums"
  ].join(' '),
  inventory: [
    "with debt as (select branch_id,raw_material_id,sum(greatest(debt_quantity-settled_quantity,0)) remaining",
    "from public.raw_fifo_debts group by 1,2) select",
    "count(*) filter(where r.quantity<0) as negatives,",
    "count(*) filter(where r.quantity<0 and coalesce(d.remaining,0)>0) as negatives_with_fifo_debt,",
    "count(*) filter(where r.quantity<0 and coalesce(d.remaining,0)=0) as negatives_without_fifo_debt,",
    "(select count(*) from public.raw_fifo_debts where debt_quantity>settled_quantity) as unsettled_fifo_debts",
    "from public.raw_material_inventory r left join debt d on d.branch_id=r.branch_id and d.raw_material_id=r.raw_material_id"
  ].join(' '),
  accounts: [
    "select",
    "(select count(*) from public.users u left join auth.users a on a.id=u.id where u.is_active and a.id is null) as active_without_auth,",
    "(select count(*) from public.branches b where not exists(select 1 from public.organization_members m where m.organization_id=b.organization_id and m.is_active)) as branches_without_members"
  ].join(' '),
};

function integer(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('INVALID_AGGREGATE');
  return n;
}

export function classifyReadiness(snapshot) {
  const checks = [];
  const check = (id, value, severity) => checks.push({
    id, count: integer(value), status: integer(value) > 0 ? severity : 'PASS'
  });
  check('missing_public_rls', snapshot.schema.unprotected_tables, 'BLOCKER');
  check('anon_public_read_grants', snapshot.schema.anon_readable_tables, 'BLOCKER');
  check('orphan_sale_items', snapshot.integrity.orphan_items, 'BLOCKER');
  check('orphan_payments', snapshot.integrity.orphan_payments, 'BLOCKER');
  check('orphan_journal_lines', snapshot.integrity.orphan_lines, 'BLOCKER');
  check('duplicate_invoice_groups', snapshot.integrity.duplicate_invoices, 'BLOCKER');
  check('unbalanced_journal_entries', snapshot.accounting.unbalanced, 'BLOCKER');
  check('unbalanced_posted_journals', snapshot.accounting.unbalanced_posted, 'BLOCKER');
  check('journal_entries_without_lines', snapshot.accounting.empty_entries, 'BLOCKER');
  check('negatives_without_fifo_debt', snapshot.inventory.negatives_without_fifo_debt, 'BLOCKER');
  check('negative_raw_balances', snapshot.inventory.negatives, 'REVIEW');
  check('unsettled_fifo_debts', snapshot.inventory.unsettled_fifo_debts, 'REVIEW');
  check('active_profiles_without_auth', snapshot.accounts.active_without_auth, 'REVIEW');
  check('branches_without_active_members', snapshot.accounts.branches_without_members, 'REVIEW');
  return {
    decision: checks.some(c => c.status === 'BLOCKER') ? 'NO_GO' :
      checks.some(c => c.status === 'REVIEW') ? 'REVIEW_REQUIRED' : 'TECHNICAL_CHECKS_PASS',
    checks,
    // The presence of WAL archiving does NOT prove a usable backup or successful restore.
    unverified: [
      'backup_restore_and_RPO_RTO',
      'cashier_sale_refund_and_shift_on_isolated_environment',
      'offline_retries_and_concurrent_idempotency',
      'printer_KDS_tax_provider_hardware',
      'security_definer_RPC_review',
      'performance_load_and_alerts'
    ]
  };
}

export function assertTarget(args, env) {
  const confirmed = args.find(arg => arg.startsWith('--confirm-project='))?.split('=')[1];
  const ref = env.SUPABASE_PROJECT_REF;
  if (!ref || !/^[a-z0-9]{20}$/.test(ref) || ref !== confirmed)
    throw new Error('PROJECT_CONFIRMATION_REQUIRED');
  if (!env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL_REQUIRED');
  const uri = new URL(env.SUPABASE_DB_URL);
  if (!['postgresql:','postgres:'].includes(uri.protocol)) throw new Error('INVALID_PROTOCOL');
  if (!uri.hostname.includes(ref) && !decodeURIComponent(uri.username).includes(ref))
    throw new Error('WRONG_PROJECT_CONNECTION');
  return { ref, url: env.SUPABASE_DB_URL };
}

export async function audit(args = process.argv.slice(2), env = process.env) {
  const { ref, url } = assertTarget(args, env);
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString:url, connectionTimeoutMillis:8000 });
  await client.connect();
  let started = false;
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    started = true;
    await client.query("SET LOCAL statement_timeout = '12000ms'");
    const snapshot = {};
    for (const [name, sql] of Object.entries(READINESS_QUERIES)) {
      const { rows } = await client.query(sql);
      if (rows.length !== 1) throw new Error('INVALID_AGGREGATE');
      snapshot[name] = rows[0];
    }
    await client.query('ROLLBACK');
    started = false;
    return { project_ref:ref, checked_at:new Date().toISOString(), ...classifyReadiness(snapshot), counts:snapshot };
  } finally {
    if (started) await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  audit().then(result => {
    process.stdout.write(JSON.stringify(result,null,2) + '\n');
    process.exitCode = result.decision === 'NO_GO' ? 2 : 0;
  }).catch(error => {
    // Do not expose DB error text or credentials in automated log output.
    const allowed = new Set(['PROJECT_CONFIRMATION_REQUIRED','SUPABASE_DB_URL_REQUIRED',
      'INVALID_PROTOCOL','WRONG_PROJECT_CONNECTION','INVALID_AGGREGATE']);
    process.stderr.write((allowed.has(error.message) ? error.message : 'READINESS_AUDIT_FAILED') + '\n');
    process.exitCode = 1;
  });
}
