import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.SUPABASE_DB_URL;
(url ? describe : describe.skip)('Premier stock / costing indexes and privilege regression', () => {
  const db = new Client({ connectionString: url });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('covers branch-aware inventory and cost ledger foreign-key lookup paths', async () => {
    const indexNames = [
      'idx_premier_batches_product_branch',
      'idx_premier_batches_warehouse_branch',
      'idx_premier_ledger_product_branch',
      'idx_premier_ledger_raw_branch',
      'idx_premier_ledger_warehouse_branch',
    ];
    const {rows} = await db.query<{indexname:string;tablename:string;indexdef:string}>(
      'select indexname,tablename,indexdef from pg_indexes where schemaname=$1 and indexname=any($2::text[])',
      ['public',indexNames]);
    expect(rows.map(r=>r.indexname).sort()).toEqual([...indexNames].sort());
    const checks = [
      ['idx_premier_batches_product_branch', 'inventory_batches', '(product_id, branch_id)'],
      ['idx_premier_batches_warehouse_branch', 'inventory_batches', '(warehouse_id, branch_id)'],
      ['idx_premier_ledger_product_branch', 'inventory_ledger', '(product_id, branch_id)'],
      ['idx_premier_ledger_raw_branch', 'inventory_ledger', '(raw_material_id, branch_id)'],
      ['idx_premier_ledger_warehouse_branch', 'inventory_ledger', '(warehouse_id, branch_id)'],
    ] as const;
    for (const [name,table,cols] of checks) {
      const row = rows.find(x=>x.indexname===name);
      expect(row?.tablename).toBe(table);
      expect(row?.indexdef).toContain(cols);
    }
  });

  it('does not expose financial stock history to the anonymous role', async () => {
    const {rows} = await db.query<{anon_ledger:boolean;anon_journal:boolean;ledger_rls:boolean;journal_rls:boolean}>(
      `select has_table_privilege('anon','public.inventory_ledger','SELECT') anon_ledger,
        has_table_privilege('anon','public.journal_entry_lines','SELECT') anon_journal,
        (select relrowsecurity from pg_class where oid='public.inventory_ledger'::regclass) ledger_rls,
        (select relrowsecurity from pg_class where oid='public.journal_entry_lines'::regclass) journal_rls`);
    expect(rows[0]).toEqual({anon_ledger:false,anon_journal:false,ledger_rls:true,journal_rls:true});
  });
});
