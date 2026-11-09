import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.SUPABASE_DB_URL;
const local = !!url && /(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//.test(url);
(local ? describe : describe.skip)('Premier atomic refund core errors (disposable PostgreSQL)', () => {
  const client = new Client({ connectionString: url });
  beforeAll(async () => { await client.connect(); });
  afterAll(async () => { await client.end(); });

  it('restores original sale item counters when refund inventory helper returns an error', async () => {
    const org = randomUUID(), branch = randomUUID(), warehouse = randomUUID();
    const user = randomUUID(), product = randomUUID(), sale = randomUUID(), item = randomUUID();
    const tag = randomUUID().replace(/-/g, '').slice(0, 12);
    const email = `ci-refund-atomic-${tag}@ci.invalid`;
    await client.query('BEGIN');
    try {
      await client.query(
        `insert into public.roles(role,name_ar,name_en,permissions,scope,is_active)
         values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true)
         on conflict(role) do nothing`);
      await client.query('insert into public.organizations(id,name,slug) values($1,$2,$3)',
        [org, 'CI Refund Atomic', `ci-refund-${tag}`]);
      await client.query(
        "insert into public.branches(id,name,organization_id,is_active) values($1,'CI Refund Branch',$2,true)",
        [branch, org]);
      await client.query('insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())',
        [user, email]);
      await client.query("select set_config('app.register_branch','on',true)");
      await client.query(
        "insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,'CI Refund Admin','super_admin',$3,true)",
        [user, email, branch]);
      await client.query(
        "select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true),set_config('app.register_branch','off',true)",
        [user, JSON.stringify({ sub: user, role: 'authenticated' })]);
      await client.query(
        "insert into public.warehouses(id,name,branch_id,is_active,is_default) values($1,'CI Refund WH',$2,true,true)",
        [warehouse, branch]);
      await client.query(
        `insert into public.products(id,name,sku,cost_price,sale_price,wholesale_price,is_active,product_type,branch_id)
         values($1,'CI Refund Product',$2,7,20,20,true,'ready',$3)`,
        [product, `CI-REF-${tag}`, branch]);
      await client.query(
        `insert into public.sales(id,invoice_number,branch_id,warehouse_id,cashier_id,subtotal,total,paid_amount,status)
         values($1,$2,$3,$4,$5,20,20,20,'completed')`,
        [sale, `CI-REFUND-${tag}`, branch, warehouse, user]);
      await client.query(
        `insert into public.sale_items(id,sale_id,product_id,quantity,unit_price,total)
         values($1,$2,$3,1,20,20)`,
        [item, sale, product]);

      // Replace the RESTORE helper only inside this transaction; ROLLBACK in
      // finally restores the canonical function and deletes all fixture rows.
      // The helper reports a normal JSON error AFTER the refund core updated
      // sale_items -- the failure path that used to commit partial state.
      await client.query(`
        create or replace function public._restore_refund_hybrid_inventory(
          p_sale_item_id uuid,p_sale_id uuid,p_product_id uuid,p_refund_qty numeric,
          p_branch_id uuid,p_warehouse_id uuid,p_reference_number text
        ) returns jsonb
        language plpgsql security definer set search_path to 'public','pg_temp'
        as $fn$
        begin
          return jsonb_build_object('success',false,'error','CI_REFUND_INVENTORY_FAILURE');
        end;
        $fn$`);

      const before = await client.query<{ refunded_quantity: string; refunded_amount: string; sale_refunded: string }>(
        `select si.refunded_quantity::text, si.refunded_amount::text,
          s.refunded_amount::text as sale_refunded
         from public.sale_items si join public.sales s on s.id=si.sale_id where si.id=$1`,
        [item],
      );
      expect(Number(before.rows[0].refunded_quantity)).toBe(0);

      const result = await client.query<{ result: { success: boolean; error?: string } }>(
        'select public.process_refund($1,$2::jsonb,$3) as result',
        [sale, JSON.stringify([{ sale_item_id: item, quantity: 1 }]), 'CI injected failure'],
      );
      expect(result.rows[0].result).toMatchObject({
        success: false, error: 'CI_REFUND_INVENTORY_FAILURE',
      });

      const after = await client.query<{ refunded_quantity: string; refunded_amount: string; sale_refunded: string }>(
        `select si.refunded_quantity::text, si.refunded_amount::text,
          s.refunded_amount::text as sale_refunded
         from public.sale_items si join public.sales s on s.id=si.sale_id where si.id=$1`,
        [item],
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
      const journals = await client.query<{ count: string }>(
        "select count(*)::text from public.journal_entries where branch_id=$1 and reference_type='refund'", [branch]);
      expect(Number(journals.rows[0].count)).toBe(0);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
