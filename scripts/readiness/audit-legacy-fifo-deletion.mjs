#!/usr/bin/env node
// Read-only deletion impact audit. NEVER deletes or alters records.
// Requires the same explicit project/connection guard as audit-production.mjs.
import { fileURLToPath } from 'node:url';
import { assertTarget } from './audit-production.mjs';

const SQL = {
  debt_scope: `select count(*)::int as total, count(*) filter (where cost_policy='legacy_fifo')::int as legacy_total,
    count(*) filter (where cost_policy is distinct from 'legacy_fifo')::int as non_legacy_total,
    count(*) filter (where debt_quantity>coalesce(settled_quantity,0))::int as open,
    count(*) filter (where debt_quantity<=coalesce(settled_quantity,0))::int as settled,
    count(distinct branch_id)::int as branches, count(distinct warehouse_id)::int as warehouses,
    count(distinct raw_material_id)::int as materials from public.raw_fifo_debts`,
  relationships: `select
    (select count(*) from public.raw_fifo_settlements)::int as cascading_settlements,
    (select count(*) from public.raw_fifo_settlements s join public.raw_fifo_debts d on d.id=s.debt_id where d.debt_quantity>coalesce(d.settled_quantity,0))::int as settlements_on_open_debts,
    (select count(*) from public.raw_fifo_debt_rebase_snapshots)::int as restricted_rebase_snapshots,
    (select count(*) from public.raw_fifo_debt_rebase_settlement_snapshots)::int as restricted_rebase_settlement_snapshots`,
  inventory: `with debt as (
    select branch_id,raw_material_id,sum(greatest(debt_quantity-coalesce(settled_quantity,0),0)) qty
    from public.raw_fifo_debts group by 1,2
  ) select count(*) filter(where i.quantity<0)::int as negative_balances,
    count(*) filter(where i.quantity<0 and coalesce(d.qty,0)>0)::int as negative_with_debt,
    count(*) filter(where i.quantity<0 and coalesce(d.qty,0)=0)::int as negative_without_debt
    from public.raw_material_inventory i left join debt d
    on d.branch_id=i.branch_id and d.raw_material_id=i.raw_material_id`,
  blocking_fks: `select count(*)::int as restrict_fk_count from pg_constraint
    where contype='f' and confrelid='public.raw_fifo_debts'::regclass and confdeltype='r'`,
  ledger: `select count(*)::int as source_ledger_rows
    from public.inventory_ledger where id in (select source_ledger_id from public.raw_fifo_debts)`
};

export function classifyImpact({ debt_scope: d, relationships: r, inventory: i, blocking_fks: f }) {
  const same = d.total === d.legacy_total && d.non_legacy_total === 0;
  const dependent = r.cascading_settlements + r.restricted_rebase_snapshots +
    r.restricted_rebase_settlement_snapshots;
  return {
    deletion_authorized: false,
    status: 'ISOLATED_REHEARSAL_REQUIRED',
    historical_scope_is_legacy_only: same,
    dependent_rows: dependent,
    warnings: [
      'Deletion cascades into settlement history and may be blocked by RESTRICT foreign keys',
      'Deleting debt records does not repair negative inventory, oversold batches or ledger balances',
      'Receipt reconciliation functions and the canonical inventory view depend on the debt table',
      'A validated isolated restore, impact diff, and independent explicit approval are required before production changes'
    ]
  };
}

export async function auditImpact(args=process.argv.slice(2),env=process.env) {
  const { ref,url }=assertTarget(args,env);
  const { default: pg }=await import('pg');
  const client=new pg.Client({connectionString:url,connectionTimeoutMillis:8000});
  await client.connect();
  let open=false;
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    open=true;
    await client.query("SET LOCAL statement_timeout = '12000ms'");
    const counts={};
    for(const [key,sql] of Object.entries(SQL)) {
      const {rows}=await client.query(sql);
      if(rows.length!==1) throw Error('INVALID_AGGREGATE');
      counts[key]=rows[0];
    }
    await client.query('ROLLBACK');open=false;
    return {project_ref:ref,checked_at:new Date().toISOString(),...classifyImpact(counts),counts};
  } finally {
    if(open) await client.query('ROLLBACK').catch(()=>{});
    await client.end();
  }
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
  auditImpact().then(x=>process.stdout.write(JSON.stringify(x,null,2)+'\n'))
    .catch(()=>{process.stderr.write('FIFO_PREFLIGHT_FAILED\n');process.exitCode=1;});
}
