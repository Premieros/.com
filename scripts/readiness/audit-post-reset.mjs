#!/usr/bin/env node
// Read-only, explicit-project audit after intentional removal of operating transactions.
// This confirms a clean starting state, NOT that a real sale or restore test passed.
import { fileURLToPath } from 'node:url';
import { assertTarget } from './audit-production.mjs';

export const POST_RESET_QUERIES = {
  catalog: `select
    (select count(*) from public.products) products,
    (select count(*) from public.raw_materials) raw_materials,
    (select count(*) from public.recipes) recipes,
    (select count(*) from public.recipe_items) recipe_items,
    (select count(*) from public.inventory_units) inventory_units,
    (select count(*) from public.users) users,
    (select count(*) from public.branches) branches,
    (select count(*) from public.warehouses) warehouses`,
  operations: `select
    (select count(*) from public.sales) sales,
    (select count(*) from public.sale_items) sale_items,
    (select count(*) from public.sale_payments) sale_payments,
    (select count(*) from public.orders) orders,
    (select count(*) from public.order_items) order_items,
    (select count(*) from public.purchases) purchases,
    (select count(*) from public.purchase_items) purchase_items,
    (select count(*) from public.journal_entries) journal_entries,
    (select count(*) from public.journal_entry_lines) journal_entry_lines,
    (select count(*) from public.inventory_ledger) inventory_ledger,
    (select count(*) from public.raw_material_inventory) raw_material_inventory,
    (select count(*) from public.raw_material_batches) raw_material_batches,
    (select count(*) from public.inventory_unit_batches) inventory_unit_batches,
    (select count(*) from public.inventory_unit_entries) inventory_unit_entries,
    (select count(*) from public.shifts) shifts,
    (select count(*) from public.stock_transactions) stock_transactions,
    (select count(*) from public.raw_fifo_debts) raw_fifo_debts,
    (select count(*) from private.raw_warehouse_balances_v2) raw_warehouse_balances,
    (select count(*) from private.erp_domain_outbox_v2) erp_outbox,
    (select count(*) from private.pos_sale_idempotency) sale_idempotency`,
  opening_balances: `select
    (select count(*) from public.customers where balance <> 0) nonzero_customer_balances,
    (select count(*) from public.suppliers where balance <> 0) nonzero_supplier_balances,
    (select count(*) from public.treasury_accounts where opening_balance <> 0) nonzero_treasury_opening_balances,
    (select count(*) from public.document_sequences where next_value <> 1) nonreset_document_sequences,
    (select count(*) from public.dining_tables where status = 'occupied') occupied_tables`,
  access: `select
    (select count(*) from public.users u left join auth.users a on a.id = u.id
     where u.is_active and a.id is null) active_profiles_without_auth,
    (select count(*) from public.branches b where not exists (
       select 1 from public.organization_members m
       where m.organization_id = b.organization_id and m.is_active
    )) branches_without_active_org_member`
};

const requiredCatalog = ['products', 'raw_materials', 'recipes', 'recipe_items', 'inventory_units', 'users', 'branches', 'warehouses'];
function safeInt(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw Error('INVALID_AGGREGATE');
  return n;
}
export function assessPostReset(snapshot) {
  if (!snapshot || !snapshot.catalog || !snapshot.operations || !snapshot.opening_balances || !snapshot.access)
    throw Error('INVALID_SNAPSHOT');
  const catalogMissing = requiredCatalog.filter(key => safeInt(snapshot.catalog[key]) === 0);
  const nonzeroOperations = Object.entries(snapshot.operations)
    .filter(([, count]) => safeInt(count) !== 0).map(([key]) => key);
  const nonzeroBalances = Object.entries(snapshot.opening_balances)
    .filter(([, count]) => safeInt(count) !== 0).map(([key]) => key);
  const accessIssues = Object.entries(snapshot.access)
    .filter(([, count]) => safeInt(count) !== 0).map(([key]) => key);
  const clean = catalogMissing.length === 0 && nonzeroOperations.length === 0 && nonzeroBalances.length === 0;
  return {
    decision: !clean ? 'RESET_INCOMPLETE' : accessIssues.length ? 'CLEAN_BASELINE_ACCESS_REVIEW' : 'CLEAN_BASELINE',
    // An empty system is not an operational acceptance test.
    customer_handoff_approved: false,
    catalog_missing: catalogMissing,
    nonzero_operations: nonzeroOperations,
    nonzero_opening_balances: nonzeroBalances,
    access_review: accessIssues,
    unverified: [
      'opening_inventory_and_first_receipt',
      'cashier_sale_refund_and_shift',
      'auth_identity_and_tenant_access',
      'concurrency_and_offline_replay',
      'backup_restore_and_RPO_RTO',
      'peripherals_and_customer_signoff'
    ]
  };
}

export async function auditPostReset(args=process.argv.slice(2), env=process.env) {
  const {ref,url}=assertTarget(args,env);
  const {default:pg}=await import('pg');
  const client=new pg.Client({connectionString:url,connectionTimeoutMillis:8000});
  await client.connect();
  let started=false;
  try {
    await client.query('BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ');
    started=true;
    await client.query("SET LOCAL statement_timeout = '12000ms'");
    const counts={};
    for (const [key,sql] of Object.entries(POST_RESET_QUERIES)) {
      const {rows}=await client.query(sql);
      if (rows.length!==1) throw Error('INVALID_AGGREGATE');
      counts[key]=rows[0];
    }
    await client.query('ROLLBACK');started=false;
    return {project_ref:ref,checked_at:new Date().toISOString(),...assessPostReset(counts),counts};
  } finally {
    if(started) await client.query('ROLLBACK').catch(()=>{});
    await client.end();
  }
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
  auditPostReset().then(x=>{process.stdout.write(JSON.stringify(x,null,2)+'\n');
    process.exitCode=x.decision==='RESET_INCOMPLETE'?2:0;})
   .catch(e=>{const safe=new Set(['PROJECT_CONFIRMATION_REQUIRED','SUPABASE_DB_URL_REQUIRED','INVALID_PROTOCOL','WRONG_PROJECT_CONNECTION','INVALID_AGGREGATE','INVALID_SNAPSHOT']);
     process.stderr.write((safe.has(e.message)?e.message:'POST_RESET_AUDIT_FAILED')+'\n');
     process.exitCode=1;});
}
