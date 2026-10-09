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

  it('classifies raw batch diagnostics without unknown states', async () => {
    const { rows } = await client.query<{
      total_rows: string;
      unknown_rows: string;
      operational_mismatch: string;
      missing_scope: string;
      anon_select: boolean;
      authenticated_select: boolean;
    }>(
      `select
         count(*)::text as total_rows,
         count(*) filter (where classification='UNKNOWN')::text as unknown_rows,
         count(*) filter (where reconciliation_status<>'MATCH')::text as operational_mismatch,
         count(*) filter (where item_id is null or branch_id is null or warehouse_id is null)::text as missing_scope,
         has_table_privilege('anon', 'private.canonical_raw_batch_diagnostics', 'SELECT') as anon_select,
         has_table_privilege('authenticated', 'private.canonical_raw_batch_diagnostics', 'SELECT') as authenticated_select
       from private.canonical_raw_batch_diagnostics`,
    );

    const state = rows[0];
    expect(Number(state?.total_rows ?? 0)).toBeGreaterThan(0);
    expect(Number(state?.unknown_rows ?? -1)).toBe(0);
    expect(Number(state?.operational_mismatch ?? -1)).toBe(0);
    expect(Number(state?.missing_scope ?? -1)).toBe(0);
    expect(state?.anon_select).toBe(false);
    expect(state?.authenticated_select).toBe(false);
  });

  it('keeps inventory review cases evidence-classified and manual-only', async () => {
    const { rows } = await client.query<{
      total_rows: string;
      unclassified_rows: string;
      unsafe_repair_policy_rows: string;
      nonreview_rows: string;
      anon_select: boolean;
      authenticated_select: boolean;
    }>(
      `select
         count(*)::text as total_rows,
         count(*) filter (where evidence_reason='UNCLASSIFIED_REVIEW')::text as unclassified_rows,
         count(*) filter (where repair_policy<>'NO_AUTOMATIC_REPAIR')::text as unsafe_repair_policy_rows,
         count(*) filter (where not requires_human_review)::text as nonreview_rows,
         has_table_privilege('anon', 'private.canonical_inventory_review_cases', 'SELECT') as anon_select,
         has_table_privilege('authenticated', 'private.canonical_inventory_review_cases', 'SELECT') as authenticated_select
       from private.canonical_inventory_review_cases`,
    );

    const state = rows[0];
    expect(Number(state?.total_rows ?? 0)).toBeGreaterThan(0);
    expect(Number(state?.unclassified_rows ?? -1)).toBe(0);
    expect(Number(state?.unsafe_repair_policy_rows ?? -1)).toBe(0);
    expect(Number(state?.nonreview_rows ?? -1)).toBe(0);
    expect(state?.anon_select).toBe(false);
    expect(state?.authenticated_select).toBe(false);
  });

  it('keeps Costing V2 concepts separated and canonical coverage complete', async () => {
    const { rows } = await client.query<{
      catalog_rows: string;
      cost_rows: string;
      duplicate_cost_rows: string;
      negative_theoretical_rows: string;
      standard_cost_rls: boolean;
      standard_auth_select: boolean;
      standard_auth_insert: boolean;
      standard_auth_update: boolean;
      standard_auth_delete: boolean;
      cost_view_anon_select: boolean;
      cost_view_auth_select: boolean;
    }>(
      `select
         (select count(*) from public.canonical_item_catalog)::text as catalog_rows,
         (select count(*) from private.canonical_item_costs)::text as cost_rows,
         (
           select count(*)
           from (
             select item_id, branch_id
             from private.canonical_item_costs
             group by item_id, branch_id
             having count(*) > 1
           ) d
         )::text as duplicate_cost_rows,
         (select count(*) from private.canonical_item_costs where theoretical_cost < 0)::text as negative_theoretical_rows,
         (
           select c.relrowsecurity
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relname = 'item_standard_costs'
             and c.relkind = 'r'
         ) as standard_cost_rls,
         has_table_privilege('authenticated', 'public.item_standard_costs', 'SELECT') as standard_auth_select,
         has_table_privilege('authenticated', 'public.item_standard_costs', 'INSERT') as standard_auth_insert,
         has_table_privilege('authenticated', 'public.item_standard_costs', 'UPDATE') as standard_auth_update,
         has_table_privilege('authenticated', 'public.item_standard_costs', 'DELETE') as standard_auth_delete,
         has_table_privilege('anon', 'private.canonical_item_costs', 'SELECT') as cost_view_anon_select,
         has_table_privilege('authenticated', 'private.canonical_item_costs', 'SELECT') as cost_view_auth_select`,
    );

    const state = rows[0];
    expect(Number(state?.cost_rows ?? -1)).toBe(Number(state?.catalog_rows ?? -2));
    expect(Number(state?.duplicate_cost_rows ?? -1)).toBe(0);
    expect(Number(state?.negative_theoretical_rows ?? -1)).toBe(0);
    expect(state?.standard_cost_rls).toBe(true);
    expect(state?.standard_auth_select).toBe(true);
    expect(state?.standard_auth_insert || state?.standard_auth_update || state?.standard_auth_delete).toBe(false);
    expect(state?.cost_view_anon_select).toBe(false);
    expect(state?.cost_view_auth_select).toBe(false);
  });

  it('keeps Standard Cost history non-overlapping and RPC exposure intentional', async () => {
    const { rows } = await client.query<{
      overlapping_periods: string;
      set_anon: boolean;
      set_auth: boolean;
      read_anon: boolean;
      read_auth: boolean;
      history_anon: boolean;
      history_auth: boolean;
      guard_anon: boolean;
      guard_auth: boolean;
      trigger_attached: boolean;
      set_search_path: boolean;
      read_search_path: boolean;
      history_search_path: boolean;
    }>(
      `select
         (
           select count(*)
           from public.item_standard_costs a
           join public.item_standard_costs b
             on b.item_id = a.item_id
            and b.branch_id = a.branch_id
            and b.id > a.id
            and tstzrange(a.effective_from, coalesce(a.effective_to, 'infinity'::timestamptz), '[)')
                && tstzrange(b.effective_from, coalesce(b.effective_to, 'infinity'::timestamptz), '[)')
         )::text as overlapping_periods,
         has_function_privilege('anon', 'public.set_item_standard_cost(uuid,uuid,numeric,text,timestamptz)', 'EXECUTE') as set_anon,
         has_function_privilege('authenticated', 'public.set_item_standard_cost(uuid,uuid,numeric,text,timestamptz)', 'EXECUTE') as set_auth,
         has_function_privilege('anon', 'public.get_item_costing_v2(uuid)', 'EXECUTE') as read_anon,
         has_function_privilege('authenticated', 'public.get_item_costing_v2(uuid)', 'EXECUTE') as read_auth,
         has_function_privilege('anon', 'public.get_item_standard_cost_history(uuid,uuid)', 'EXECUTE') as history_anon,
         has_function_privilege('authenticated', 'public.get_item_standard_cost_history(uuid,uuid)', 'EXECUTE') as history_auth,
         has_function_privilege('anon', 'private.guard_item_standard_cost_overlap()', 'EXECUTE') as guard_anon,
         has_function_privilege('authenticated', 'private.guard_item_standard_cost_overlap()', 'EXECUTE') as guard_auth,
         exists (
           select 1
           from pg_trigger t
           join pg_class c on c.oid=t.tgrelid
           join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public'
             and c.relname='item_standard_costs'
             and t.tgname='trg_guard_item_standard_cost_overlap'
             and not t.tgisinternal
         ) as trigger_attached,
         exists (
           select 1 from pg_proc p
           join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='set_item_standard_cost'
             and exists (
               select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
               where cfg like 'search_path=%'
             )
         ) as set_search_path,
         exists (
           select 1 from pg_proc p
           join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='get_item_costing_v2'
             and exists (
               select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
               where cfg like 'search_path=%'
             )
         ) as read_search_path,
         exists (
           select 1 from pg_proc p
           join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='get_item_standard_cost_history'
             and exists (
               select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
               where cfg like 'search_path=%'
             )
         ) as history_search_path`,
    );

    const state = rows[0];
    expect(Number(state?.overlapping_periods ?? -1)).toBe(0);
    expect(state?.set_anon).toBe(false);
    expect(state?.set_auth).toBe(true);
    expect(state?.read_anon).toBe(false);
    expect(state?.read_auth).toBe(true);
    expect(state?.history_anon).toBe(false);
    expect(state?.history_auth).toBe(true);
    expect(state?.guard_anon).toBe(false);
    expect(state?.guard_auth).toBe(false);
    expect(state?.trigger_attached).toBe(true);
    expect(state?.set_search_path && state?.read_search_path && state?.history_search_path).toBe(true);
  });

  it('keeps sale cost variance coverage explicit and internally consistent', async () => {
    const { rows } = await client.query<{
      sales: string;
      eligible_sales: string;
      actual_missing: string;
      invalid_actual_basis: string;
      negative_actual: string;
      negative_theoretical: string;
      invalid_variance_rows: string;
      invalid_modifier_status: string;
      invalid_theoretical_basis: string;
      anon_select: boolean;
      authenticated_select: boolean;
    }>(
      `select
         count(*)::text as sales,
         (
           select count(*)
           from public.sales s
           where coalesce(s.is_archived,false)=false
             and coalesce(s.status,'') not in ('returned','cancelled')
         )::text as eligible_sales,
         count(*) filter (where actual_cogs_basis='MISSING')::text as actual_missing,
         count(*) filter (
           where actual_cogs_basis not in ('JOURNAL_POSTED','KITCHEN_SNAPSHOT','LEGACY_LEDGER','MISSING')
         )::text as invalid_actual_basis,
         count(*) filter (where actual_cogs<0)::text as negative_actual,
         count(*) filter (where current_theoretical_cost<0)::text as negative_theoretical,
         count(*) filter (
           where actual_vs_theoretical_variance is not null
             and (
               actual_cogs is null
               or current_theoretical_cost is null
               or theoretical_coverage_status<>'COMPLETE'
             )
         )::text as invalid_variance_rows,
         count(*) filter (
           where theoretical_coverage_status='MODIFIER_UNMODELED'
             and modifier_line_count<=0
         )::text as invalid_modifier_status,
         count(*) filter (
           where theoretical_basis<>'CURRENT_RECIPE_REFERENCE_NOT_HISTORICAL'
         )::text as invalid_theoretical_basis,
         has_table_privilege('anon', 'private.canonical_sale_cost_variance', 'SELECT') as anon_select,
         has_table_privilege('authenticated', 'private.canonical_sale_cost_variance', 'SELECT') as authenticated_select
       from private.canonical_sale_cost_variance`,
    );

    const state = rows[0];
    expect(Number(state?.sales ?? -1)).toBe(Number(state?.eligible_sales ?? -2));
    expect(Number(state?.actual_missing ?? 999999)).toBeLessThanOrEqual(1);
    expect(Number(state?.invalid_actual_basis ?? -1)).toBe(0);
    expect(Number(state?.negative_actual ?? -1)).toBe(0);
    expect(Number(state?.negative_theoretical ?? -1)).toBe(0);
    expect(Number(state?.invalid_variance_rows ?? -1)).toBe(0);
    expect(Number(state?.invalid_modifier_status ?? -1)).toBe(0);
    expect(Number(state?.invalid_theoretical_basis ?? -1)).toBe(0);
    expect(state?.anon_select).toBe(false);
    expect(state?.authenticated_select).toBe(false);
  });

  it('keeps purchase variance based on normalized receipt cost and prior purchase references', async () => {
    const { rows } = await client.query<{
      groups: string;
      expected_groups: string;
      actual_missing: string;
      unmapped_items: string;
      negative_actual_cost: string;
      negative_received_qty: string;
      invalid_reference_variance: string;
      invalid_standard_variance: string;
      anon_select: boolean;
      authenticated_select: boolean;
    }>(
      `select
         count(*)::text as groups,
         (
           select count(*)
           from (
             select p.id, pi.raw_material_id
             from public.purchases p
             join public.purchase_items pi on pi.purchase_id=p.id
             where pi.raw_material_id is not null
             group by p.id,pi.raw_material_id
           ) g
         )::text as expected_groups,
         count(*) filter (where actual_cost_status='MISSING_LEDGER')::text as actual_missing,
         count(*) filter (where item_id is null)::text as unmapped_items,
         count(*) filter (where actual_base_unit_cost<0)::text as negative_actual_cost,
         count(*) filter (where received_base_quantity<0)::text as negative_received_qty,
         count(*) filter (
           where actual_vs_reference_unit_variance is not null
             and (actual_base_unit_cost is null or prior_reference_unit_cost is null)
         )::text as invalid_reference_variance,
         count(*) filter (
           where actual_vs_standard_unit_variance is not null
             and (actual_base_unit_cost is null or standard_unit_cost is null)
         )::text as invalid_standard_variance,
         has_table_privilege('anon', 'private.canonical_purchase_cost_variance', 'SELECT') as anon_select,
         has_table_privilege('authenticated', 'private.canonical_purchase_cost_variance', 'SELECT') as authenticated_select
       from private.canonical_purchase_cost_variance`,
    );

    const state = rows[0];
    expect(Number(state?.groups ?? -1)).toBe(Number(state?.expected_groups ?? -2));
    expect(Number(state?.actual_missing ?? 999999)).toBeLessThanOrEqual(12);
    expect(Number(state?.unmapped_items ?? -1)).toBe(0);
    expect(Number(state?.negative_actual_cost ?? -1)).toBe(0);
    expect(Number(state?.negative_received_qty ?? -1)).toBe(0);
    expect(Number(state?.invalid_reference_variance ?? -1)).toBe(0);
    expect(Number(state?.invalid_standard_variance ?? -1)).toBe(0);
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
