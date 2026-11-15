import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.SUPABASE_DB_URL;
(url ? describe : describe.skip)('Premier consolidated inventory, costing, accounting and branch integrity', () => {
  const db = new Client({ connectionString: url });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('has validated operational branch constraints and guarded component links', async () => {
    const expected = [
      'premier_inventory_batches_product_branch_fk',
      'premier_inventory_batches_warehouse_branch_fk',
      'premier_production_orders_product_branch_fk',
      'premier_production_orders_warehouse_branch_fk',
      'premier_raw_batches_material_branch_fk',
      'premier_raw_batches_warehouse_branch_fk',
      'premier_raw_inventory_material_branch_fk',
      'premier_inventory_ledger_product_branch_fk',
      'premier_inventory_ledger_material_branch_fk',
      'premier_inventory_ledger_warehouse_branch_fk',
      'premier_inventory_movements_product_branch_fk',
      'premier_inventory_movements_warehouse_branch_fk',
      'premier_raw_movements_material_branch_fk',
      'premier_raw_movements_warehouse_branch_fk',
      'premier_unit_entries_warehouse_branch_fk',
    ];
    const { rows: constraints } = await db.query<{ conname: string; convalidated: boolean }>(
      `select conname, convalidated from pg_constraint
       where connamespace='public'::regnamespace and conname=any($1::text[])`, [expected]);
    expect(constraints).toHaveLength(expected.length);
    expect(constraints.every(c => c.convalidated)).toBe(true);

    const { rows: triggers } = await db.query<{ tgname: string }>(
      `select tgname from pg_trigger where not tgisinternal
       and tgname = any($1::text[])`, [[
        'trg_premier_guard_product_component_branch',
        'trg_premier_guard_product_unit_link_branch',
        'trg_premier_guard_product_branch_move',
        'trg_premier_guard_inventory_unit_branch_move',
      ]]);
    expect(triggers).toHaveLength(4);
  });

  it('never exposes current cross-branch BOM, recipe or unit links', async () => {
    const {rows} = await db.query<{issues:string}>(`
      select (
        (select count(*) from public.product_components c
          join public.products p on p.id=c.product_id
          join public.products cp on cp.id=c.component_product_id
          where p.branch_id is distinct from cp.branch_id)
        + (select count(*) from public.product_unit_links l
          join public.products p on p.id=l.product_id
          join public.inventory_units u on u.id=l.unit_id
          where p.branch_id is distinct from u.branch_id)
        + (select count(*) from public.recipe_items ri
          join public.recipes r on r.id=ri.recipe_id
          join public.raw_materials m on m.id=ri.raw_material_id
          where r.branch_id is distinct from m.branch_id)
      )::text issues`);
    expect(rows[0].issues).toBe('0');
  });

  it('preserves ledger arithmetic and balanced journals', async () => {
    const {rows} = await db.query<{
      ledger_issues:string; bad_journals:string; raw_stock_issues:string
    }>(`
      with r as (
        select raw_material_id,branch_id,sum(quantity) quantity
        from public.raw_material_batches group by 1,2
      ),
      raw_issues as (
        select count(*) bad from (
          select raw_material_id,branch_id from public.raw_material_inventory
          union
          select raw_material_id,branch_id from r
        ) k
        left join public.raw_material_inventory i using(raw_material_id,branch_id)
        left join r using(raw_material_id,branch_id)
        where abs(coalesce(i.quantity,0)-coalesce(r.quantity,0))>0.001
      ),
      journals as (
        select j.id,coalesce(sum(l.debit),0) debit,coalesce(sum(l.credit),0) credit
        from public.journal_entries j
        left join public.journal_entry_lines l on l.journal_entry_id=j.id
        group by j.id
      )
      select
        (select count(*)::text from public.inventory_ledger
          where abs(total_cost-quantity*unit_cost)>0.02) ledger_issues,
        (select count(*)::text from journals where abs(debit-credit)>0.01) bad_journals,
        (select bad::text from raw_issues) raw_stock_issues
    `);
    expect(rows[0]).toEqual({
      ledger_issues:'0', bad_journals:'0', raw_stock_issues:'0',
    });
  });

  it('keeps database access controls for cost/accounting history', async () => {
    const {rows}=await db.query<{anon_journal:boolean;anon_ledger:boolean;rls:boolean}>(
      `select
        has_table_privilege('anon','public.journal_entry_lines','INSERT') anon_journal,
        has_table_privilege('anon','public.inventory_ledger','INSERT') anon_ledger,
        (select relrowsecurity from pg_class where oid='public.inventory_ledger'::regclass) rls`);
    expect(rows[0]).toEqual({anon_journal:false,anon_ledger:false,rls:true});
  });
});
