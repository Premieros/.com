import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dbUrl = process.env.SUPABASE_DB_URL;
const disposable = Boolean(dbUrl && /(?:localhost|127\.0\.0\.1|\[::1\])/.test(new URL(dbUrl).hostname));
(disposable ? describe : describe.skip)('PR 318 canonical semi-finished projection', () => {
  const db = new Client({ connectionString: dbUrl });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('counts linked negative batches once, retains unrepresented debt and preserves debt diagnostics', async () => {
    const org = randomUUID(), branch = randomUUID(), wh = randomUUID();
    const linked = randomUUID(), unlinked = randomUUID(), batch = randomUUID();
    const tag = randomUUID().slice(0, 8);
    await db.query('BEGIN');
    try {
      await db.query('insert into public.organizations(id,name,slug) values($1,$2,$3)', [org, 'CI Projection', 'ci-proj-' + tag]);
      await db.query('insert into public.branches(id,name,organization_id) values($1,$2,$3)', [branch, 'CI Projection', org]);
      await db.query('insert into public.warehouses(id,name,branch_id,is_active,is_default) values($1,$2,$3,true,true)', [wh, 'CI Warehouse', branch]);
      await db.query("insert into public.inventory_units(id,code,name,unit_type,branch_id) values($1,$2,'CI Linked','manufactured',$3),($4,$5,'CI Unlinked','manufactured',$3)", [linked,'CI-L-' + tag,branch,unlinked,'CI-U-' + tag]);
      await db.query('insert into public.inventory_unit_batches(id,unit_id,branch_id,warehouse_id,batch_number,quantity,unit_cost) values($1,$2,$3,$4,$5,-0.5,0)', [batch,linked,branch,wh,'OV-' + tag]);
      await db.query('insert into public.inventory_unit_batches(unit_id,branch_id,warehouse_id,batch_number,quantity,unit_cost) values($1,$2,$3,$4,2,1)', [unlinked,branch,wh,'CI-P-' + tag]);
      await db.query("insert into public.inventory_unit_entries(unit_id,branch_id,warehouse_id,quantity,unit_cost,entry_type) values($1,$2,$3,-0.5,0,'sale'),($4,$2,$3,1.5,1,'production')", [linked,branch,wh,unlinked]);
      await db.query('insert into public.inventory_unit_stock_debts(unit_id,branch_id,warehouse_id,oversold_batch_id,debt_quantity) values($1,$2,$3,$4,0.5),($5,$2,$3,null,0.5)', [linked,branch,wh,batch,unlinked]);
      const get = async (unitId: string) => (await db.query(
        "select v.quantity::float8 qty,v.open_debt_quantity::float8 debt,v.movement_delta::float8 delta,v.reconciliation_status status from private.canonical_inventory_balances v join private.item_legacy_links l on l.item_id=v.item_id where l.source_table='inventory_units' and l.source_id=$1 and v.inventory_kind='SEMI_FINISHED' and v.branch_id=$2 and v.warehouse_id=$3",
        [unitId,branch,wh],
      )).rows[0];
      expect(await get(linked)).toEqual({qty:-0.5,debt:0.5,delta:0,status:'MATCH'});
      expect(await get(unlinked)).toEqual({qty:1.5,debt:0.5,delta:0,status:'MATCH'});
    } finally { await db.query('ROLLBACK'); }
  });
});
