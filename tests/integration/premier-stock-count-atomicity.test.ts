import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// This test MUST run only on disposable PostgreSQL prepared by CI.
const dbUrl = process.env.SUPABASE_DB_URL;
const isLocal = !!dbUrl && /(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//.test(dbUrl);
const describeLocal = isLocal ? describe : describe.skip;

describeLocal('Premier real SQL stock count atomicity (disposable PostgreSQL only)', () => {
  const client = new Client({ connectionString: dbUrl });
  beforeAll(async () => { await client.connect(); });
  afterAll(async () => { await client.end(); });

  it('reverses first-line stock, movement and accounting writes when the second line errors', async () => {
    const orgId = randomUUID();
    const branchId = randomUUID();
    const warehouseId = randomUUID();
    const userId = randomUUID();
    const firstProduct = randomUUID();
    const secondProduct = randomUUID();
    const countId = randomUUID();
    const tag = randomUUID().replace(/-/g, '').slice(0, 12);
    const firstItem = '00000000-0000-0000-0000-000000000011';
    const secondItem = '00000000-0000-0000-0000-000000000022';

    await client.query('BEGIN');
    try {
      await client.query(
        `insert into public.roles(role,name_ar,name_en,permissions,scope,is_active)
         values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true)
         on conflict(role) do nothing`,
      );
      await client.query('insert into public.organizations(id,name,slug) values($1,$2,$3)',
        [orgId, 'CI Atomic Count', `ci-atomic-${tag}`]);
      await client.query(
        "insert into public.branches(id,name,organization_id,is_active) values($1,'CI Atomic Branch',$2,true)",
        [branchId, orgId],
      );
      const email = `ci-atomic-${tag}@ci.invalid`;
      await client.query('insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())',
        [userId, email]);
      await client.query("select set_config('app.register_branch','on',true)");
      await client.query(
        "insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,'CI Atomic User','super_admin',$3,true)",
        [userId, email, branchId],
      );
      await client.query(
        "select set_config('app.user_id',$1,true), set_config('app.jwt',$2,true), set_config('app.register_branch','off',true)",
        [userId, JSON.stringify({ sub: userId, role: 'authenticated' })],
      );
      await client.query(
        "insert into public.warehouses(id,name,branch_id,is_active,is_default) values($1,'CI Atomic WH',$2,true,true)",
        [warehouseId, branchId],
      );
      await client.query('select public.seed_account_mappings($1)', [branchId]);
      await client.query(
        `insert into public.products(id,name,sku,cost_price,sale_price,wholesale_price,is_active,product_type,branch_id)
         values($1,'CI First Product',$3,2,4,4,true,'ready',$5),
               ($2,'CI Second Product',$4,2,4,4,true,'ready',$5)`,
        [firstProduct, secondProduct, `CI-A-${tag}`, `CI-B-${tag}`, branchId],
      );
      await client.query(
        `insert into public.stock_counts(id,branch_id,warehouse_id,status,count_type,created_by,count_number)
         values($1,$2,$3,'approved','cycle',$4,$5)`,
        [countId, branchId, warehouseId, userId, `CI-COUNT-${tag}`],
      );
      await client.query(
        `insert into public.stock_count_items(id,stock_count_id,product_id,system_quantity,counted_quantity,unit_cost)
         values($1,$3,$4,0,2,2),($2,$3,$5,0,3,2)`,
        [firstItem, secondItem, countId, firstProduct, secondProduct],
      );

      // A CI-only fault on the second item forces the real public.apply_stock_count
      // to hit its error path AFTER the first product was already adjusted.
      // The temporary trigger and every fixture row are rolled back below.
      await client.query(`
        create function pg_temp.ci_fail_second_count_ledger()
        returns trigger language plpgsql as $$
        begin
          if new.product_id = '${secondProduct}'::uuid
             and new.reference_type = 'stock_count' then
            raise exception 'CI_INJECTED_SECOND_LINE_FAILURE';
          end if;
          return new;
        end;
        $$`);
      await client.query(`
        create trigger ci_fail_second_count_ledger
        before insert on public.inventory_ledger
        for each row execute function pg_temp.ci_fail_second_count_ledger()`);

      const before = await client.query<{
        stock: string; ledger: string; transactions: string; journals: string;
      }>(`
        select
          (select count(*)::text from public.inventory where warehouse_id=$1) as stock,
          (select count(*)::text from public.inventory_ledger where branch_id=$2) as ledger,
          (select count(*)::text from public.stock_transactions where branch_id=$2) as transactions,
          (select count(*)::text from public.journal_entries where branch_id=$2) as journals
      `, [warehouseId, branchId]);

      const { rows } = await client.query<{ result: { success?: boolean; error?: string; detail?: string } }>(
        'select public.apply_stock_count($1) as result', [countId],
      );
      expect(rows[0].result.success, JSON.stringify(rows[0].result)).toBe(false);
      expect(rows[0].result.error).toBe('TRANSACTION_FAILED');
      expect(rows[0].result.detail).toContain('CI_INJECTED_SECOND_LINE_FAILURE');

      const after = await client.query<{
        stock: string; ledger: string; transactions: string; journals: string; status: string;
      }>(`
        select
          (select count(*)::text from public.inventory where warehouse_id=$1) as stock,
          (select count(*)::text from public.inventory_ledger where branch_id=$2) as ledger,
          (select count(*)::text from public.stock_transactions where branch_id=$2) as transactions,
          (select count(*)::text from public.journal_entries where branch_id=$2) as journals,
          (select status from public.stock_counts where id=$3) as status
      `, [warehouseId, branchId, countId]);
      expect(after.rows[0]).toEqual({ ...before.rows[0], status: 'approved' });
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
