import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL required');

describe('canonical stock snapshot/debt projection regression', () => {
  const db = new Client({ connectionString });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('uses most recently appended ledger after_qty even when an opening event is backdated', async () => {
    const orgId = randomUUID();
    const branchId = randomUUID();
    const warehouseId = randomUUID();
    const uomId = randomUUID();
    const rawId = randomUUID();
    const tag = randomUUID().slice(0, 9);

    await db.query('BEGIN');
    try {
      await db.query(
        'insert into public.organizations(id,name,slug) values($1,$2,$3)',
        [orgId, 'CI Stock Snapshot', `ci-stock-projection-${tag}`],
      );
      await db.query(
        "insert into public.branches(id,name,organization_id,is_active) values($1,'CI Branch',$2,true)",
        [branchId, orgId],
      );
      await db.query(
        "insert into public.warehouses(id,name,branch_id,is_active) values($1,'CI Store',$2,true)",
        [warehouseId, branchId],
      );
      await db.query(
        "insert into public.measurement_units(id,code,name,symbol,is_active) values($1,$2,'CI Unit','u',true)",
        [uomId, `CI-SNAP-${tag}`],
      );
      await db.query(
        "insert into public.raw_materials(id,code,name,unit_id,branch_id,is_active) values($1,$2,'CI Stock Raw',$3,$4,true)",
        [rawId, `CI-RAW-${tag}`, uomId, branchId],
      );
      await db.query(
        'insert into public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost) values($1,$2,79.4,0)',
        [rawId, branchId],
      );
      await db.query(
        "insert into public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type) values($1,$2,$3,$4,79.4,0,'opening')",
        [rawId, branchId, warehouseId, `CI-SNAP-B-${tag}`],
      );
      // A September purchase posted first, then an opening correction was
      // appended later but carries an older business created_at timestamp.
      await db.query(
        `insert into public.inventory_ledger(
          raw_material_id,branch_id,warehouse_id,quantity,before_qty,after_qty,
          unit_cost,total_cost,entry_type,reference_type,created_at)
         values($1,$2,$3,50,0,50,0,0,'purchase','purchase','2026-09-21T09:00:00Z')`,
        [rawId, branchId, warehouseId],
      );
      await db.query(
        `insert into public.inventory_ledger(
          raw_material_id,branch_id,warehouse_id,quantity,before_qty,after_qty,
          unit_cost,total_cost,entry_type,reference_type,created_at)
         values($1,$2,$3,29.4,50,79.4,0,0,'opening','historical_opening','2026-08-31T21:00:00Z')`,
        [rawId, branchId, warehouseId],
      );

      const { rows } = await db.query<{
        quantity: string; movement_quantity: string;
        movement_delta: string; reconciliation_status: string;
      }>(`
        select c.quantity,c.movement_quantity,c.movement_delta,c.reconciliation_status
        from private.canonical_inventory_balances c
        join private.item_legacy_links l on l.item_id=c.item_id
        where l.source_table='raw_materials' and l.source_id=$1
          and c.branch_id=$2
      `, [rawId, branchId]);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].quantity)).toBeCloseTo(79.4, 4);
      expect(Number(rows[0].movement_quantity)).toBeCloseTo(79.4, 4);
      expect(Number(rows[0].movement_delta)).toBeCloseTo(0, 4);
      expect(rows[0].reconciliation_status).toBe('MATCH');
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('does not double subtract a signed negative unit batch already in movement entries', async () => {
    const orgId = randomUUID();
    const branchId = randomUUID();
    const warehouseId = randomUUID();
    const unitId = randomUUID();
    const tag = randomUUID().slice(0, 9);

    await db.query('BEGIN');
    try {
      await db.query('insert into public.organizations(id,name,slug) values($1,$2,$3)',
        [orgId, 'CI Unit Debt', `ci-unit-debt-${tag}`]);
      await db.query(
        "insert into public.branches(id,name,organization_id,is_active) values($1,'CI Unit Branch',$2,true)",
        [branchId, orgId],
      );
      await db.query(
        "insert into public.warehouses(id,name,branch_id,is_active) values($1,'CI Unit Store',$2,true)",
        [warehouseId, branchId],
      );
      await db.query(
        "insert into public.inventory_units(id,code,name,unit_type,branch_id,is_active) values($1,$2,'CI Prepared Unit','manufactured',$3,true)",
        [unitId, `CI-UNIT-${tag}`, branchId],
      );
      const { rows: batches } = await db.query<{ id: string }>(
        `insert into public.inventory_unit_batches(
            unit_id,branch_id,warehouse_id,batch_number,quantity,unit_cost)
          values($1,$2,$3,$4,-7,0) returning id`,
        [unitId, branchId, warehouseId, `CI-NEG-${tag}`],
      );
      await db.query(
        "insert into public.inventory_unit_entries(unit_id,branch_id,warehouse_id,quantity,entry_type) values($1,$2,$3,-7,'sale')",
        [unitId, branchId, warehouseId],
      );
      await db.query(
        `insert into public.inventory_unit_stock_debts(
           unit_id,branch_id,warehouse_id,oversold_batch_id,debt_quantity,settled_quantity)
         values($1,$2,$3,$4,7,0)`,
        [unitId, branchId, warehouseId, batches[0].id],
      );

      const { rows } = await db.query<{
        quantity: string; batch_quantity: string; open_debt_quantity: string;
        movement_quantity: string; movement_delta: string; reconciliation_status: string;
      }>(`
        select c.quantity,c.batch_quantity,c.open_debt_quantity,
               c.movement_quantity,c.movement_delta,c.reconciliation_status
        from private.canonical_inventory_balances c
        join private.item_legacy_links l on l.item_id=c.item_id
        where l.source_table='inventory_units' and l.source_id=$1
          and c.branch_id=$2 and c.warehouse_id=$3
      `, [unitId, branchId, warehouseId]);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].quantity)).toBe(-7);
      expect(Number(rows[0].batch_quantity)).toBe(-7);
      expect(Number(rows[0].open_debt_quantity)).toBe(7);
      expect(Number(rows[0].movement_quantity)).toBe(-7);
      expect(Number(rows[0].movement_delta)).toBe(0);
      expect(rows[0].reconciliation_status).toBe('MATCH');
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
