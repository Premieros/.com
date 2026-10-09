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

  it('keeps exact same-role same-command permissive policy duplicates at zero', async () => {
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

  it('keeps measurement_units as the canonical UOM master with units as an exact compatibility view', async () => {
    const { rows } = await client.query<{
      measurement_count: string;
      compatibility_count: string;
      mismatches: string;
      units_is_security_invoker: boolean;
    }>(
      `select
         (select count(*) from public.measurement_units)::text as measurement_count,
         (select count(*) from public.units)::text as compatibility_count,
         (
           select count(*)
           from (
             (select id, code, name, symbol, is_active from public.measurement_units
              except
              select id, code, name, symbol, is_active from public.units)
             union all
             (select id, code, name, symbol, is_active from public.units
              except
              select id, code, name, symbol, is_active from public.measurement_units)
           ) d
         )::text as mismatches,
         exists (
           select 1
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relname = 'units'
             and c.relkind = 'v'
             and coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=true%'
         ) as units_is_security_invoker`,
    );

    const state = rows[0];
    expect(Number(state?.measurement_count ?? 0)).toBe(Number(state?.compatibility_count ?? -1));
    expect(Number(state?.mismatches ?? -1)).toBe(0);
    expect(state?.units_is_security_invoker).toBe(true);
  });

  it('keeps canonical item mappings complete and attribute-consistent', async () => {
    const { rows } = await client.query<{
      source_total: string;
      link_total: string;
      site_total: string;
      unmapped: string;
      attribute_mismatches: string;
      duplicate_item_links: string;
    }>(
      `with source_total as (
         select
           (select count(*) from public.products)
           + (select count(*) from public.raw_materials)
           + (select count(*) from public.inventory_units) as value
       ),
       unmapped as (
         select count(*) as value
         from (
           select 'products'::text source_table, p.id source_id from public.products p
           union all
           select 'raw_materials', r.id from public.raw_materials r
           union all
           select 'inventory_units', u.id from public.inventory_units u
         ) s
         where not exists (
           select 1
           from private.item_legacy_links l
           where l.source_table = s.source_table
             and l.source_id = s.source_id
         )
       ),
       mismatches as (
         select count(*) as value
         from (
           select l.item_id
           from private.item_legacy_links l
           join public.products p
             on l.source_table = 'products' and l.source_id = p.id
           join public.branches b on b.id = p.branch_id
           join public.items i on i.id = l.item_id
           join public.item_sites s on s.item_id = i.id and s.branch_id = p.branch_id
           where i.organization_id <> b.organization_id
              or i.name <> p.name
              or coalesce(i.sku, '') <> coalesce(nullif(p.sku, ''), '')
              or coalesce(i.barcode, '') <> coalesce(nullif(p.barcode, ''), '')
              or s.min_stock <> p.min_stock
              or s.max_stock <> p.max_stock
              or s.reorder_point <> p.reorder_point
           union all
           select l.item_id
           from private.item_legacy_links l
           join public.raw_materials r
             on l.source_table = 'raw_materials' and l.source_id = r.id
           join public.branches b on b.id = r.branch_id
           join public.items i on i.id = l.item_id
           join public.item_sites s on s.item_id = i.id and s.branch_id = r.branch_id
           where i.organization_id <> b.organization_id
              or i.name <> r.name
              or coalesce(i.code, '') <> coalesce(nullif(r.code, ''), '')
              or i.base_uom_id is distinct from r.unit_id
              or s.min_stock <> r.min_stock
           union all
           select l.item_id
           from private.item_legacy_links l
           join public.inventory_units u
             on l.source_table = 'inventory_units' and l.source_id = u.id
           join public.branches b on b.id = u.branch_id
           join public.items i on i.id = l.item_id
           join public.item_sites s on s.item_id = i.id and s.branch_id = u.branch_id
           where i.organization_id <> b.organization_id
              or i.name <> u.name
              or coalesce(i.code, '') <> coalesce(nullif(u.code, ''), '')
              or s.min_stock <> u.min_stock
              or s.max_stock <> u.max_stock
              or s.reorder_point <> u.reorder_point
         ) d
       )
       select
         (select value from source_total)::text as source_total,
         (select count(*) from private.item_legacy_links)::text as link_total,
         (select count(*) from public.item_sites)::text as site_total,
         (select value from unmapped)::text as unmapped,
         (select value from mismatches)::text as attribute_mismatches,
         (
           select count(*)
           from (
             select item_id
             from private.item_legacy_links
             group by item_id
             having count(*) > 1
           ) d
         )::text as duplicate_item_links`,
    );

    const state = rows[0];
    const total = Number(state?.source_total ?? 0);
    expect(Number(state?.link_total ?? -1)).toBe(total);
    expect(Number(state?.site_total ?? -1)).toBe(total);
    expect(Number(state?.unmapped ?? -1)).toBe(0);
    expect(Number(state?.attribute_mismatches ?? -1)).toBe(0);
    expect(Number(state?.duplicate_item_links ?? -1)).toBe(0);
  });

  it('keeps canonical item sync triggers private and attached', async () => {
    const { rows } = await client.query<{
      table_name: string;
      trigger_name: string;
      function_signature: string;
      anon_exec: boolean;
      authenticated_exec: boolean;
      security_definer: boolean;
      has_search_path: boolean;
    }>(
      `select
         c.relname as table_name,
         t.tgname as trigger_name,
         p.oid::regprocedure::text as function_signature,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
         p.prosecdef as security_definer,
         exists (
           select 1
           from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
           where cfg like 'search_path=%'
         ) as has_search_path
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_proc p on p.oid = t.tgfoid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and t.tgname = any($1::text[])
       order by c.relname`,
      [[
        'trg_sync_product_canonical_item',
        'trg_sync_raw_material_canonical_item',
        'trg_sync_inventory_unit_canonical_item',
      ]],
    );

    expect(rows).toHaveLength(3);
    expect(rows.every((row) =>
      row.security_definer
      && row.has_search_path
      && !row.anon_exec
      && !row.authenticated_exec
      && row.function_signature.startsWith('private.')
    )).toBe(true);
  });

  it('keeps canonical dual-read reconciliation green and security-invoker', async () => {
    const { rows } = await client.query<{
      mismatches: string;
      absolute_delta: string;
      security_invoker: boolean;
      anon_select: boolean;
      authenticated_select: boolean;
    }>(
      `select
         count(*) filter (where not is_match)::text as mismatches,
         coalesce(sum(abs(delta)), 0)::text as absolute_delta,
         exists (
           select 1
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relname = 'canonical_item_reconciliation'
             and c.relkind = 'v'
             and coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=true%'
         ) as security_invoker,
         has_table_privilege('anon', 'public.canonical_item_reconciliation', 'SELECT') as anon_select,
         has_table_privilege('authenticated', 'public.canonical_item_reconciliation', 'SELECT') as authenticated_select
       from public.canonical_item_reconciliation`,
    );

    const state = rows[0];
    expect(Number(state?.mismatches ?? -1)).toBe(0);
    expect(Number(state?.absolute_delta ?? -1)).toBe(0);
    expect(state?.security_invoker).toBe(true);
    expect(state?.anon_select).toBe(false);
    expect(state?.authenticated_select).toBe(true);
  });

  it('keeps canonical item catalog security-invoker and count-equivalent to legacy sources', async () => {
    const { rows } = await client.query<{
      security_invoker: boolean;
      anon_select: boolean;
      authenticated_select: boolean;
      canonical_products: string;
      legacy_products: string;
      canonical_raws: string;
      legacy_raws: string;
      canonical_units: string;
      legacy_units: string;
    }>(
      `select
         exists (
           select 1
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relname = 'canonical_item_catalog'
             and c.relkind = 'v'
             and coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=true%'
         ) as security_invoker,
         has_table_privilege('anon', 'public.canonical_item_catalog', 'SELECT') as anon_select,
         has_table_privilege('authenticated', 'public.canonical_item_catalog', 'SELECT') as authenticated_select,
         (select count(*) from public.canonical_item_catalog where item_type in ('FINISHED_GOOD','RETAIL_ITEM'))::text as canonical_products,
         (select count(*) from public.products)::text as legacy_products,
         (select count(*) from public.canonical_item_catalog where item_type = 'RAW_MATERIAL')::text as canonical_raws,
         (select count(*) from public.raw_materials)::text as legacy_raws,
         (select count(*) from public.canonical_item_catalog where item_type = 'SEMI_FINISHED')::text as canonical_units,
         (select count(*) from public.inventory_units)::text as legacy_units`,
    );

    const state = rows[0];
    expect(state?.security_invoker).toBe(true);
    expect(state?.anon_select).toBe(false);
    expect(state?.authenticated_select).toBe(true);
    expect(Number(state?.canonical_products ?? -1)).toBe(Number(state?.legacy_products ?? -2));
    expect(Number(state?.canonical_raws ?? -1)).toBe(Number(state?.legacy_raws ?? -2));
    expect(Number(state?.canonical_units ?? -1)).toBe(Number(state?.legacy_units ?? -2));
  });

  it('keeps canonical item tables read-only for authenticated clients during compatibility phase', async () => {
    const { rows } = await client.query<{
      items_select: boolean;
      items_insert: boolean;
      items_update: boolean;
      items_delete: boolean;
      sites_select: boolean;
      sites_insert: boolean;
      sites_update: boolean;
      sites_delete: boolean;
      legacy_links_any: boolean;
    }>(
      `select
         has_table_privilege('authenticated', 'public.items', 'SELECT') as items_select,
         has_table_privilege('authenticated', 'public.items', 'INSERT') as items_insert,
         has_table_privilege('authenticated', 'public.items', 'UPDATE') as items_update,
         has_table_privilege('authenticated', 'public.items', 'DELETE') as items_delete,
         has_table_privilege('authenticated', 'public.item_sites', 'SELECT') as sites_select,
         has_table_privilege('authenticated', 'public.item_sites', 'INSERT') as sites_insert,
         has_table_privilege('authenticated', 'public.item_sites', 'UPDATE') as sites_update,
         has_table_privilege('authenticated', 'public.item_sites', 'DELETE') as sites_delete,
         has_table_privilege('authenticated', 'private.item_legacy_links', 'SELECT,INSERT,UPDATE,DELETE') as legacy_links_any`,
    );

    const state = rows[0];
    expect(state?.items_select).toBe(true);
    expect(state?.sites_select).toBe(true);
    expect(state?.items_insert || state?.items_update || state?.items_delete).toBe(false);
    expect(state?.sites_insert || state?.sites_update || state?.sites_delete).toBe(false);
    expect(state?.legacy_links_any).toBe(false);
  });

  it('keeps canonical inventory movement read model complete and private', async () => {
    const { rows } = await client.query<{
      source_rows: string;
      canonical_rows: string;
      missing_item_id: string;
      missing_branch: string;
      missing_warehouse: string;
      duplicate_source_rows: string;
      missing_ledger_rows: string;
      missing_unit_rows: string;
      anon_select: boolean;
      authenticated_select: boolean;
    }>(
      `select
         (
           (select count(*) from public.inventory_ledger)
           + (select count(*) from public.inventory_unit_entries)
         )::text as source_rows,
         (select count(*) from private.canonical_inventory_movements)::text as canonical_rows,
         (select count(*) from private.canonical_inventory_movements where item_id is null)::text as missing_item_id,
         (select count(*) from private.canonical_inventory_movements where branch_id is null)::text as missing_branch,
         (select count(*) from private.canonical_inventory_movements where warehouse_id is null)::text as missing_warehouse,
         (
           select count(*)
           from (
             select source_stream, source_entry_id
             from private.canonical_inventory_movements
             group by source_stream, source_entry_id
             having count(*) > 1
           ) d
         )::text as duplicate_source_rows,
         (
           select count(*)
           from public.inventory_ledger il
           where not exists (
             select 1
             from private.canonical_inventory_movements c
             where c.source_stream = 'inventory_ledger'
               and c.source_entry_id = il.id::text
           )
         )::text as missing_ledger_rows,
         (
           select count(*)
           from public.inventory_unit_entries iue
           where not exists (
             select 1
             from private.canonical_inventory_movements c
             where c.source_stream = 'inventory_unit_entries'
               and c.source_entry_id = iue.id::text
           )
         )::text as missing_unit_rows,
         has_table_privilege('anon', 'private.canonical_inventory_movements', 'SELECT') as anon_select,
         has_table_privilege('authenticated', 'private.canonical_inventory_movements', 'SELECT') as authenticated_select`,
    );

    const state = rows[0];
    expect(Number(state?.canonical_rows ?? -1)).toBe(Number(state?.source_rows ?? -2));
    expect(Number(state?.missing_item_id ?? -1)).toBe(0);
    expect(Number(state?.missing_branch ?? -1)).toBe(0);
    expect(Number(state?.missing_warehouse ?? -1)).toBe(0);
    expect(Number(state?.duplicate_source_rows ?? -1)).toBe(0);
    expect(Number(state?.missing_ledger_rows ?? -1)).toBe(0);
    expect(Number(state?.missing_unit_rows ?? -1)).toBe(0);
    expect(state?.anon_select).toBe(false);
    expect(state?.authenticated_select).toBe(false);
  });

  it('keeps canonical inventory balances reconciled to operational sources', async () => {
    const { rows } = await client.query<{
      rows: string;
      raw_rows: string;
      unit_rows: string;
      missing_item_id: string;
      missing_branch: string;
      missing_warehouse: string;
      reconciliation_mismatch: string;
      branch_only_scope: string;
      max_movement_delta: string;
      anon_select: boolean;
      authenticated_select: boolean;
    }>(
      `select
         count(*)::text as rows,
         count(*) filter (where inventory_kind='RAW_MATERIAL')::text as raw_rows,
         count(*) filter (where inventory_kind='SEMI_FINISHED')::text as unit_rows,
         count(*) filter (where item_id is null)::text as missing_item_id,
         count(*) filter (where branch_id is null)::text as missing_branch,
         count(*) filter (where warehouse_id is null)::text as missing_warehouse,
         count(*) filter (where reconciliation_status <> 'MATCH')::text as reconciliation_mismatch,
         count(*) filter (where warehouse_scope = 'LEGACY_BRANCH_ONLY')::text as branch_only_scope,
         max(abs(coalesce(movement_delta,0)))::text as max_movement_delta,
         has_table_privilege('anon', 'private.canonical_inventory_balances', 'SELECT') as anon_select,
         has_table_privilege('authenticated', 'private.canonical_inventory_balances', 'SELECT') as authenticated_select
       from private.canonical_inventory_balances`,
    );

    const state = rows[0];
    expect(Number(state?.rows ?? 0)).toBeGreaterThan(0);
    expect(Number(state?.raw_rows ?? 0)).toBeGreaterThan(0);
    expect(Number(state?.unit_rows ?? 0)).toBeGreaterThan(0);
    expect(Number(state?.missing_item_id ?? -1)).toBe(0);
    expect(Number(state?.missing_branch ?? -1)).toBe(0);
    expect(Number(state?.missing_warehouse ?? -1)).toBe(0);
    expect(Number(state?.reconciliation_mismatch ?? -1)).toBe(0);
    expect(Number(state?.branch_only_scope ?? -1)).toBe(0);
    expect(Number(state?.max_movement_delta ?? -1)).toBe(0);
    expect(state?.anon_select).toBe(false);
    expect(state?.authenticated_select).toBe(false);
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
