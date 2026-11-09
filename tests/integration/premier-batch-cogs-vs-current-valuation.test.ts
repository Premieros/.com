import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.SUPABASE_DB_URL;
const onDisposableDb = !!url && /(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//.test(url);

(onDisposableDb ? describe : describe.skip)('Premier historical batch COGS vs current display valuation (disposable PostgreSQL)', () => {
  const client = new Client({ connectionString: url });
  beforeAll(async () => { await client.connect(); });
  afterAll(async () => { await client.end(); });

  it('posts the consumed batch cost, never the mutable catalog cost, and keeps current valuation separate', async () => {
    const org = randomUUID(), branch = randomUUID(), warehouse = randomUUID();
    const user = randomUUID(), product = randomUUID(), sale = randomUUID();
    const tag = randomUUID().replace(/-/g, '').slice(0, 12);
    const email = `ci-batch-cogs-${tag}@ci.invalid`;

    await client.query('BEGIN');
    try {
      await client.query(
        `insert into public.roles(role,name_ar,name_en,permissions,scope,is_active)
         values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true)
         on conflict(role) do nothing`,
      );
      await client.query('insert into public.organizations(id,name,slug) values($1,$2,$3)',
        [org, 'CI Batch COGS', `ci-cogs-${tag}`]);
      await client.query(
        "insert into public.branches(id,name,organization_id,is_active) values($1,'CI Batch COGS Branch',$2,true)",
        [branch, org]);
      await client.query('insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())',
        [user, email]);
      await client.query("select set_config('app.register_branch','on',true)");
      await client.query(
        "insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,'CI Batch COGS','super_admin',$3,true)",
        [user, email, branch]);
      await client.query(
        "select set_config('app.user_id',$1,true), set_config('app.jwt',$2,true), set_config('app.register_branch','off',true)",
        [user, JSON.stringify({ sub: user, role: 'authenticated' })]);
      await client.query(
        "insert into public.warehouses(id,name,branch_id,is_active,is_default) values($1,'CI Batch Warehouse',$2,true,true)",
        [warehouse, branch]);
      await client.query(
        `insert into public.products(id,name,sku,cost_price,sale_price,wholesale_price,is_active,product_type,branch_id)
         values($1,'CI Batch Product',$2,2,10,10,true,'ready',$3)`,
        [product, `CI-COST-${tag}`, branch]);
      // Actual received/manufactured batch cost = 7, current catalog cost = 2.
      await client.query(
        `insert into public.inventory_batches(product_id,warehouse_id,branch_id,batch_number,quantity,unit_cost)
         values($1,$2,$3,$4,5,7)`,
        [product, warehouse, branch, `BATCH-${tag}`]);
      await client.query(
        'insert into public.inventory(product_id,warehouse_id,branch_id,quantity) values($1,$2,$3,5)',
        [product, warehouse, branch]);

      const response = await client.query<{ result: { success?: boolean; total_cost?: number; removed?: number } }>(
        'select public._deduct_ready_product_stock_policy($1,$2,$3,3,$4,$5,false) as result',
        [product, branch, warehouse, sale, `CI-SALE-${tag}`],
      );
      expect(response.rows[0].result, JSON.stringify(response.rows[0].result)).toMatchObject({
        success: true, removed: 3,
      });
      expect(Number(response.rows[0].result.total_cost)).toBe(21);

      const movements = await client.query<{
        ledger_qty: string; ledger_cost: string; ledger_value: string;
        stock_qty: string; stock_cost: string; remaining_qty: string;
      }>(`
        select
          (select sum(quantity)::text from public.inventory_ledger where reference_id=$1 and product_id=$2 and entry_type='sale') ledger_qty,
          (select sum(unit_cost)::text from public.inventory_ledger where reference_id=$1 and product_id=$2 and entry_type='sale') ledger_cost,
          (select sum(total_cost)::text from public.inventory_ledger where reference_id=$1 and product_id=$2 and entry_type='sale') ledger_value,
          (select sum(quantity)::text from public.stock_transactions where reference_id=$1 and product_id=$2 and transaction_type='sale') stock_qty,
          (select sum(unit_cost)::text from public.stock_transactions where reference_id=$1 and product_id=$2 and transaction_type='sale') stock_cost,
          (select sum(quantity)::text from public.inventory_batches where product_id=$2 and warehouse_id=$3) remaining_qty
      `, [sale, product, warehouse]);
      expect(Number(movements.rows[0].ledger_qty)).toBe(-3);
      expect(Number(movements.rows[0].ledger_cost)).toBe(7);
      expect(Number(movements.rows[0].ledger_value)).toBe(-21);
      expect(Number(movements.rows[0].stock_qty)).toBe(-3);
      expect(Number(movements.rows[0].stock_cost)).toBe(7);
      expect(Number(movements.rows[0].remaining_qty)).toBe(2);

      const current = await client.query<{ quantity: string; unit_cost: string; total_value: string }>(
        'select quantity::text,unit_cost::text,total_value::text from public.get_stock_valuation($1,$2) where product_id=$3',
        [branch, warehouse, product],
      );
      expect(current.rows).toHaveLength(1);
      expect(Number(current.rows[0].quantity)).toBe(2);
      expect(Number(current.rows[0].unit_cost)).toBe(2);
      expect(Number(current.rows[0].total_value)).toBe(4);
      // The current cost display is intentionally NOT equal to historical COGS.
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
