import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
  throw new Error('SUPABASE_DB_URL is required for database integration tests');
}

describe('Architecture V2 P-A safety baseline', () => {
  const client = new Client({ connectionString });

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it('keeps RLS enabled on every public base table', async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `select c.relname as table_name
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'
         and not c.relrowsecurity
       order by c.relname`,
    );

    expect(rows).toEqual([]);
  });

  it('keeps public views security-invoker', async () => {
    const { rows } = await client.query<{ view_name: string }>(
      `select c.relname as view_name
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'v'
         and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=true%'
       order by c.relname`,
    );

    expect(rows).toEqual([]);
  });

  it('does not allow unexpected PUBLIC/anon execution of SECURITY DEFINER functions', async () => {
    const temporaryBaselineAllowlist = ['register_trial_tenant'];

    const { rows } = await client.query<{ function_name: string }>(
      `select distinct p.proname as function_name
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prosecdef
         and (
           has_function_privilege('public', p.oid, 'EXECUTE')
           or has_function_privilege('anon', p.oid, 'EXECUTE')
         )
         and not (p.proname = any($1::text[]))
       order by p.proname`,
      [temporaryBaselineAllowlist],
    );

    expect(rows).toEqual([]);
  });

  it('keeps internal low-level helpers unreachable by anon/authenticated clients', async () => {
    const internalHelpers = [
      '_raw_inventory_actual_avg_cost_guard',
      '_raw_price_oversold_batch_from_fifo',
      'treasury_accounts_fill_model_defaults',
      '_deduct_sale_inventory_with_modifiers_core',
      '_effective_branch_tax',
      '_normalize_raw_purchase_uom',
      '_normalize_thermal_print_payload',
      '_product_inv_add',
      '_product_inv_move',
      '_product_inv_remove_fifo',
      '_treasury_guard',
    ];

    const { rows } = await client.query<{
      function_name: string;
      anon_exec: boolean;
      authenticated_exec: boolean;
    }>(
      `select distinct
         p.proname as function_name,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = any($1::text[])
       order by p.proname`,
      [internalHelpers],
    );

    expect(rows).toHaveLength(internalHelpers.length);
    expect(rows.every((row) => !row.anon_exec && !row.authenticated_exec)).toBe(true);
  });

  it('does not increase duplicate permissive RLS policy groups above the P-A baseline', async () => {
    const { rows } = await client.query<{ duplicate_groups: string }>(
      `select count(*)::text as duplicate_groups
       from (
         select tablename, cmd, roles
         from pg_policies
         where schemaname = 'public'
           and permissive = 'PERMISSIVE'
         group by tablename, cmd, roles
         having count(*) > 1
       ) q`,
    );

    expect(Number(rows[0]?.duplicate_groups ?? 0)).toBe(0);
  });

  it('keeps consolidated kitchen write policies in place', async () => {
    const expected = [
      'auth_insert_order_kitchen_sends_combined',
      'auth_update_order_kitchen_sends_combined',
    ];

    const { rows } = await client.query<{ policyname: string }>(
      `select policyname
       from pg_policies
       where schemaname = 'public'
         and tablename = 'order_kitchen_sends'
         and policyname = any($1::text[])
       order by policyname`,
      [expected],
    );

    expect(rows.map((row) => row.policyname)).toEqual(expected);
  });

  it('keeps the redundant deny-only kitchen delete policy removed', async () => {
    const { rows } = await client.query<{ policyname: string }>(
      `select policyname
       from pg_policies
       where schemaname = 'public'
         and tablename = 'order_kitchen_sends'
         and policyname = 'auth_delete_order_kitchen_sends'`,
    );

    expect(rows).toEqual([]);
  });

  it('keeps every posted journal balanced', async () => {
    const { rows } = await client.query<{ journal_entry_id: string }>(
      `select je.id::text as journal_entry_id
       from public.journal_entries je
       join public.journal_entry_lines jl on jl.journal_entry_id = je.id
       group by je.id
       having round(coalesce(sum(jl.debit), 0), 2)
           <> round(coalesce(sum(jl.credit), 0), 2)
       limit 20`,
    );

    expect(rows).toEqual([]);
  });

  it('keeps core operational scope explicit', async () => {
    const { rows } = await client.query<{
      branches_without_org: string;
      sales_without_branch: string;
      purchases_without_branch: string;
      purchases_without_warehouse: string;
      batches_without_warehouse: string;
      warehouses_without_branch: string;
    }>(
      `select
         (select count(*) from public.branches where organization_id is null)::text as branches_without_org,
         (select count(*) from public.sales where branch_id is null)::text as sales_without_branch,
         (select count(*) from public.purchases where branch_id is null)::text as purchases_without_branch,
         (select count(*) from public.purchases where warehouse_id is null)::text as purchases_without_warehouse,
         (select count(*) from public.raw_material_batches where warehouse_id is null)::text as batches_without_warehouse,
         (select count(*) from public.warehouses where branch_id is null)::text as warehouses_without_branch`,
    );

    const state = rows[0];
    expect(Number(state?.branches_without_org ?? 0)).toBe(0);
    expect(Number(state?.sales_without_branch ?? 0)).toBe(0);
    expect(Number(state?.purchases_without_branch ?? 0)).toBe(0);
    expect(Number(state?.purchases_without_warehouse ?? 0)).toBe(0);
    expect(Number(state?.batches_without_warehouse ?? 0)).toBe(0);
    expect(Number(state?.warehouses_without_branch ?? 0)).toBe(0);
  });

  it('keeps refunds and returns within their source quantities', async () => {
    const { rows } = await client.query<{ kind: string; id: string }>(
      `select 'sale_item'::text as kind, id::text
       from public.sale_items
       where refunded_quantity < 0
          or refunded_quantity > quantity
       union all
       select 'purchase_item'::text as kind, id::text
       from public.purchase_items
       where returned_quantity < 0
          or returned_quantity > quantity
       limit 20`,
    );

    expect(rows).toEqual([]);
  });
});
