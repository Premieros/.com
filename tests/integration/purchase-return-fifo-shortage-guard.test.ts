import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

// This regression must run only on CI's disposable PostgreSQL fixture.
// It creates all business data inside an explicit rolled-back transaction.
const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error('SUPABASE_DB_URL required');

describe('Purchase returns must fail closed on FIFO shortage', () => {
  const db = new Client({ connectionString: url });
  beforeAll(async () => db.connect());
  afterAll(async () => db.end());

  it('does not mark a raw-material or finished-product purchase returned without removing stock', async () => {
    await db.query('BEGIN');
    try {
      const org = randomUUID(), branch = randomUUID(), warehouse = randomUUID();
      const user = randomUUID(), unit = randomUUID(), raw = randomUUID(), product = randomUUID();
      const rawPurchase = randomUUID(), productPurchase = randomUUID();
      const token = randomUUID().replace(/-/g, '').slice(0, 12);
      const email = `ci-fifo-return-${token}@ci.invalid`;

      await db.query(
        "insert into public.roles(role,name_ar,name_en,permissions,scope,is_active) values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true) on conflict(role) do nothing",
      );
      await db.query('insert into public.organizations(id,name,slug) values($1,$2,$3)',
        [org, 'CI FIFO Return Org', `ci-fifo-${token}`]);
      await db.query('insert into public.branches(id,name,organization_id) values($1,$2,$3)',
        [branch, 'CI FIFO Return Branch', org]);
      await db.query('insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())',
        [user, email]);
      await db.query("select set_config('app.register_branch','on',true)");
      await db.query(
        "insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,'CI FIFO Return','super_admin',$3,true)",
        [user, email, branch],
      );
      await db.query(
        "select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true),set_config('app.register_branch','off',true)",
        [user, JSON.stringify({ sub: user, role: 'authenticated' })],
      );
      await db.query(
        "insert into public.warehouses(id,name,branch_id,is_active,is_default) values($1,'CI FIFO Warehouse',$2,true,true)",
        [warehouse, branch],
      );
      await db.query(
        'insert into public.measurement_units(id,code,name,symbol,is_active) values($1,$2,\'CI Unit\',\'u\',true)',
        [unit, `CIFU-${token}`],
      );
      await db.query(
        "insert into public.raw_materials(id,code,name,unit_id,branch_id) values($1,$2,'CI FIFO Raw',$3,$4)",
        [raw, `CIFR-${token}`, unit, branch],
      );
      await db.query(
        "insert into public.products(id,name,sku,cost_price,sale_price,wholesale_price,is_active,product_type,branch_id) values($1,'CI FIFO Product',$2,1,5,5,true,'ready',$3)",
        [product, `CIFP-${token}`, branch],
      );
      await db.query(
        "insert into public.purchases(id,invoice_number,branch_id,warehouse_id,status,total) values($1,$3,$5,$6,'completed',10),($2,$4,$5,$6,'completed',10)",
        [rawPurchase, productPurchase, `CIR-${token}`, `CIP-${token}`, branch, warehouse],
      );
      await db.query(
        'insert into public.purchase_items(purchase_id,raw_material_id,unit_name,quantity,unit_cost,total) values($1,$2,\'u\',1,10,10)',
        [rawPurchase, raw],
      );
      await db.query(
        'insert into public.purchase_items(purchase_id,product_id,quantity,unit_cost,total) values($1,$2,1,10,10)',
        [productPurchase, product],
      );

      // Both helpers return success=true with shortage=1 on an empty inventory.
      // A purchase-return wrapper MUST NOT accept those partial/no-op removals.
      for (const purchaseId of [rawPurchase, productPurchase]) {
        const { rows: [result] } = await db.query<{ result: { success: boolean; error?: string; detail?: string } }>(
          "select public.process_purchase_return($1,NULL,'CI rollback-only shortage test') result",
          [purchaseId],
        );
        expect(result.result.success).toBe(false);
        expect(result.result.detail).toContain('PURCHASE_RETURN_INSUFFICIENT_STOCK');
      }

      const { rows: [state] } = await db.query<{
        completed: string; returned_lines: string; returned_ledger: string;
      }>(
        `select
           (select count(*)::text from public.purchases where id=any($1::uuid[]) and status='completed') completed,
           (select count(*)::text from public.purchase_items where purchase_id=any($1::uuid[]) and returned_quantity<>0) returned_lines,
           (select count(*)::text from public.inventory_ledger where reference_id=any($1::uuid[]) and entry_type='purchase_return') returned_ledger`,
        [[rawPurchase, productPurchase]],
      );
      expect(state).toEqual({ completed: '2', returned_lines: '0', returned_ledger: '0' });
      
      // Sufficient stock must retain the legitimate completed-return workflow.
      // Use a separate purchase/receipt batch after the rejected cases.
      const stockedPurchase = randomUUID();
      await db.query(
        "insert into public.purchases(id,invoice_number,branch_id,warehouse_id,status,total) values($1,$2,$3,$4,'completed',10)",
        [stockedPurchase, `CI-STOCKED-${token}`, branch, warehouse],
      );
      await db.query(
        "insert into public.purchase_items(purchase_id,raw_material_id,unit_name,quantity,unit_cost,total) values($1,$2,'u',1,10,10)",
        [stockedPurchase, raw],
      );
      await db.query(
        "insert into public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type,source_id) values($1,$2,$3,$4,2,10,'purchase',$5)",
        [raw, branch, warehouse, `CI-BATCH-${token}`, stockedPurchase],
      );
      await db.query(
        'insert into public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost) values($1,$2,2,10)',
        [raw, branch],
      );
      const { rows: [accepted] } = await db.query<{ result: { success: boolean; error?: string } }>(
        "select public.process_purchase_return($1,NULL,'CI rollback-only valid return') result",
        [stockedPurchase],
      );
      expect(accepted.result.success, JSON.stringify(accepted.result)).toBe(true);
      const { rows: [acceptedState] } = await db.query<{ remaining: string; status: string; returned_quantity: string }>(
        `select
          (select quantity::text from public.raw_material_inventory where raw_material_id=$1 and branch_id=$2) remaining,
          (select status from public.purchases where id=$3) status,
          (select returned_quantity::text from public.purchase_items where purchase_id=$3) returned_quantity`,
        [raw, branch, stockedPurchase],
      );
      expect(Number(acceptedState.remaining)).toBe(1);
      expect(acceptedState.status).toBe('returned');
      expect(Number(acceptedState.returned_quantity)).toBe(1);
      
      // A partial FIFO removal must be rolled back atomically if its remainder
      // is unavailable (not merely rejected when starting stock is zero).
      const partialPurchase = randomUUID();
      await db.query(
        "insert into public.purchases(id,invoice_number,branch_id,warehouse_id,status,total) values($1,$2,$3,$4,'completed',20)",
        [partialPurchase, `CI-PARTIAL-${token}`, branch, warehouse],
      );
      await db.query(
        "insert into public.purchase_items(purchase_id,raw_material_id,unit_name,quantity,unit_cost,total) values($1,$2,'u',2,10,20)",
        [partialPurchase, raw],
      );
      const { rows: [partialResult] } = await db.query<{ result: { success: boolean; detail?: string } }>(
        "select public.process_purchase_return($1,NULL,'CI rollback-only partial FIFO test') result",
        [partialPurchase],
      );
      expect(partialResult.result.success).toBe(false);
      expect(partialResult.result.detail).toContain('PURCHASE_RETURN_INSUFFICIENT_STOCK');

      const { rows: [partialState] } = await db.query<{
        inventory: string; batches: string; returned_qty: string; purchase_status: string; reversal_ledger: string;
      }>(
        `select
          (select quantity::text from public.raw_material_inventory where raw_material_id=$1 and branch_id=$2) inventory,
          (select coalesce(sum(quantity),0)::text from public.raw_material_batches where raw_material_id=$1 and branch_id=$2) batches,
          (select returned_quantity::text from public.purchase_items where purchase_id=$3) returned_qty,
          (select status from public.purchases where id=$3) purchase_status,
          (select count(*)::text from public.inventory_ledger where reference_id=$3 and entry_type='purchase_return') reversal_ledger`,
        [raw, branch, partialPurchase],
      );
      expect(Number(partialState.inventory)).toBe(1);
      expect(Number(partialState.batches)).toBe(1);
      expect(Number(partialState.returned_qty)).toBe(0);
      expect(partialState.purchase_status).toBe('completed');
      expect(partialState.reversal_ledger).toBe('0');

      // A multi-line return is all-or-nothing if any component is short.
      // The raw component has one unit available but the ready product has none.
      const mixedPurchase = randomUUID();
      await db.query(
        "insert into public.purchases(id,invoice_number,branch_id,warehouse_id,status,total) values($1,$2,$3,$4,'completed',20)",
        [mixedPurchase, `CI-MIXED-${token}`, branch, warehouse],
      );
      await db.query(
        "insert into public.purchase_items(purchase_id,raw_material_id,unit_name,quantity,unit_cost,total) values($1,$2,'u',1,10,10)",
        [mixedPurchase, raw],
      );
      await db.query(
        "insert into public.purchase_items(purchase_id,product_id,quantity,unit_cost,total) values($1,$2,1,10,10)",
        [mixedPurchase, product],
      );
      const { rows: [mixedResult] } = await db.query<{ result: { success: boolean; detail?: string } }>(
        "select public.process_purchase_return($1,NULL,'CI atomic mixed-item return') result",
        [mixedPurchase],
      );
      expect(mixedResult.result.success).toBe(false);
      expect(mixedResult.result.detail).toContain('PURCHASE_RETURN_INSUFFICIENT_STOCK');
      const { rows: [mixedState] } = await db.query<{
        raw_inventory: string; raw_batch_qty: string; returned_lines: string;
        purchase_status: string; reversed_movements: string;
      }>(
        `select
          (select quantity::text from public.raw_material_inventory where raw_material_id=$1 and branch_id=$2) raw_inventory,
          (select coalesce(sum(quantity),0)::text from public.raw_material_batches where raw_material_id=$1 and branch_id=$2) raw_batch_qty,
          (select count(*)::text from public.purchase_items where purchase_id=$3 and returned_quantity<>0) returned_lines,
          (select status from public.purchases where id=$3) purchase_status,
          (select count(*)::text from public.inventory_ledger where reference_id=$3 and entry_type='purchase_return') reversed_movements`,
        [raw, branch, mixedPurchase],
      );
      expect(Number(mixedState.raw_inventory)).toBe(1);
      expect(Number(mixedState.raw_batch_qty)).toBe(1);
      expect(mixedState.returned_lines).toBe('0');
      expect(mixedState.purchase_status).toBe('completed');
      expect(mixedState.reversed_movements).toBe('0');


    } finally {
      await db.query('ROLLBACK');
    }
  });
});
