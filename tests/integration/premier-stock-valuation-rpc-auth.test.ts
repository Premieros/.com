import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// This suite must never point at the hosted Supabase database.
const dbUrl = process.env.SUPABASE_DB_URL;
const local = !!dbUrl && /(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//.test(dbUrl);

(local ? describe : describe.skip)('Premier stock valuation RPC authorization (disposable Postgres)', () => {
  const db = new Client({ connectionString: dbUrl });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('rejects missing branch, inaccessible branches, warehouse mismatch, and users without inventory.view', async () => {
    const orgA = randomUUID(), orgB = randomUUID();
    const branchA = randomUUID(), branchB = randomUUID();
    const whA = randomUUID(), whB = randomUUID();
    const productA = randomUUID(), productB = randomUUID();
    const allowedUser = randomUUID(), deniedUser = randomUUID();
    const tag = randomUUID().replace(/-/g, '').slice(0, 12);
    const allowedRole = `ci_val_yes_${tag}`, deniedRole = `ci_val_no_${tag}`;

    await db.query('BEGIN');
    try {
      await db.query(
        `insert into public.roles(role,name_ar,name_en,permissions,scope,is_active)
         values($1,'مراجع مخزون','CI Valuation Reader','["inventory.view"]'::jsonb,'branch',true),
               ($2,'بلا صلاحيات','CI No Valuation Permission','[]'::jsonb,'branch',true)`,
        [allowedRole, deniedRole],
      );
      await db.query(
        `insert into public.organizations(id,name,slug)
         values($1,'CI Valuation Org A',$3),($2,'CI Valuation Org B',$4)`,
        [orgA, orgB, `ci-val-a-${tag}`, `ci-val-b-${tag}`],
      );
      await db.query(
        `insert into public.branches(id,name,organization_id,is_active)
         values($1,'CI Valuation Branch A',$3,true),($2,'CI Valuation Branch B',$4,true)`,
        [branchA, branchB, orgA, orgB],
      );
      await db.query(
        `insert into auth.users(id,email,created_at,updated_at)
         values($1,$3,now(),now()),($2,$4,now(),now())`,
        [allowedUser, deniedUser, `ci-val-allow-${tag}@ci.invalid`, `ci-val-deny-${tag}@ci.invalid`],
      );
      await db.query("select set_config('app.register_branch','on',true)");
      await db.query(
        `insert into public.users(id,email,full_name,role,branch_id,is_active)
         values($1,$3,'CI Reader',$5,$7,true),($2,$4,'CI Denied',$6,$7,true)`,
        [allowedUser, deniedUser, `ci-val-allow-${tag}@ci.invalid`,
          `ci-val-deny-${tag}@ci.invalid`, allowedRole, deniedRole, branchA],
      );
      await db.query("select set_config('app.register_branch','off',true)");
      await db.query(
        `insert into public.warehouses(id,name,branch_id,is_active,is_default)
         values($1,'CI Valuation WH A',$3,true,true),($2,'CI Valuation WH B',$4,true,true)`,
        [whA, whB, branchA, branchB],
      );
      await db.query(
        `insert into public.products(id,name,sku,cost_price,sale_price,wholesale_price,is_active,product_type,branch_id)
         values($1,'Valuation A',$3,7,9,9,true,'ready',$5),
               ($2,'Valuation B',$4,13,17,17,true,'ready',$6)`,
        [productA, productB, `CI-VAL-A-${tag}`, `CI-VAL-B-${tag}`, branchA, branchB],
      );
      await db.query(
        `insert into public.inventory(product_id,warehouse_id,branch_id,quantity)
         values($1,$3,$5,2),($2,$4,$6,3)`,
        [productA, productB, whA, whB, branchA, branchB],
      );

      // Exercise the actual granted RPC as the authenticated database role,
      // not as the PostgreSQL migration owner who bypasses RLS.
      await db.query('SET LOCAL ROLE authenticated');
      const become = async (id: string) => {
        await db.query(
          "select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true)",
          [id, JSON.stringify({ sub: id, role: 'authenticated' })],
        );
      };
      const shouldReject = async (sql: string, args: unknown[], code: string, message: string) => {
        await db.query('SAVEPOINT val_rpc_rejected');
        try {
          await expect(db.query(sql, args)).rejects.toMatchObject({ code, message: expect.stringContaining(message) });
        } finally {
          await db.query('ROLLBACK TO SAVEPOINT val_rpc_rejected');
          await db.query('RELEASE SAVEPOINT val_rpc_rejected');
        }
      };

      await become(allowedUser);
      const valid = await db.query<{ product_id: string; branch_id: string; total_value: string }>(
        'select product_id,branch_id,total_value from public.get_stock_valuation($1,$2)',
        [branchA, whA],
      );
      expect(valid.rows).toHaveLength(1);
      expect(valid.rows[0].product_id).toBe(productA);
      expect(valid.rows[0].branch_id).toBe(branchA);
      expect(Number(valid.rows[0].total_value)).toBe(14);

      await shouldReject(
        'select * from public.get_stock_valuation(null::uuid,null::uuid)',
        [], '22023', 'STOCK_VALUATION_BRANCH_REQUIRED',
      );
      await shouldReject(
        'select * from public.get_stock_valuation($1,null::uuid)',
        [branchB], '42501', 'STOCK_VALUATION_BRANCH_DENIED',
      );
      await shouldReject(
        'select * from public.get_stock_valuation($1,$2)',
        [branchA, whB], '22023', 'STOCK_VALUATION_WAREHOUSE_BRANCH_MISMATCH',
      );

      await become(deniedUser);
      await shouldReject(
        'select * from public.get_stock_valuation($1,null::uuid)',
        [branchA], '42501', 'STOCK_VALUATION_PERMISSION_DENIED',
      );

      await db.query("select set_config('app.user_id','',true),set_config('app.jwt','{}',true)");
      await shouldReject(
        'select * from public.get_stock_valuation($1,null::uuid)',
        [branchA], '42501', 'STOCK_VALUATION_AUTH_REQUIRED',
      );
      await db.query('RESET ROLE');
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
