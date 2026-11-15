import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dbUrl = process.env.SUPABASE_DB_URL;
const isolated = Boolean(dbUrl && ['localhost', '127.0.0.1', '[::1]'].some(host => dbUrl.includes(host)));

(isolated ? describe : describe.skip)('QR customer history access and visit-scoped data', () => {
  const db = new Client({ connectionString: dbUrl });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('requires a permitted branch and retains each customer rating with the correct QR profile', async () => {
    const org = randomUUID(), branch = randomUUID(), otherBranch = randomUUID();
    const profile = randomUUID(), otherProfile = randomUUID(), visit = randomUUID(), rating = randomUUID(), table = randomUUID();
    const user = randomUUID(), marker = randomUUID().slice(0, 8);
    await db.query('BEGIN');
    try {
      await db.query(`insert into public.roles(role,name_ar,name_en,permissions,scope,is_active)
        values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true)
        on conflict(role) do nothing`);
      await db.query('insert into public.organizations(id,name,slug) values($1,$2,$3)', [org,'CI customer history', `ci-qr-history-${marker}`]);
      for (const id of [branch, otherBranch]) {
        await db.query('insert into public.branches(id,name,organization_id) values($1,$2,$3)', [id,'CI Branch',org]);
      }
      await db.query('insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())',
        [user, `ci-history-${marker}@ci.invalid`]);
      await db.query("select set_config('app.register_branch','on',true)");
      await db.query('insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,$3,$4,$5,true)',
        [user,`ci-history-${marker}@ci.invalid`,'CI Manager','super_admin',branch]);
      await db.query("select set_config('app.user_id',$1,true),set_config('app.register_branch','off',true)", [user]);
      await db.query('insert into public.dining_tables(id,branch_id,name) values($1,$2,$3)', [table,branch,'Test Table']);
      await db.query('insert into qr_private.customer_profiles(id,branch_id,phone,name) values($1,$2,$3,$4)',
        [profile,branch,'01000001111','Guest Alpha']);
      await db.query('insert into qr_private.customer_profiles(id,branch_id,phone,name) values($1,$2,$3,$4)',
        [otherProfile,otherBranch,'01000002222','Guest Beta']);
      await db.query(`insert into qr_private.visits(id,branch_id,generation,profile_id,guest_hash,origin_table_id,order_type)
        values($1,$2,gen_random_uuid(),$3,$4,$5,'delivery')`, [visit,branch,profile,'ci-hash',table]);
      await db.query(`insert into qr_private.guest_ratings(id,visit_id,branch_id,overall,food,service,note)
        values($1,$2,$3,5,4,5,'CI feedback')`, [rating,visit,branch]);
      const history = (await db.query<{ data: { id: string; rating_count: number; ratings: { note: string }[]; purchases: { id: string }[]; total_spent: number }[] }>(
        'select public.qr_customer_history($1) data', [branch])).rows[0].data;
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ id: profile, rating_count: 1, total_spent: 0 });
      expect(history[0].ratings[0].note).toBe('CI feedback');
      expect(history[0].purchases).toEqual([]); // An unbilled visit cannot create a purchase.
      expect(history.some(row => row.id === otherProfile)).toBe(false);

      await db.query('SAVEPOINT denied');
      await db.query("select set_config('app.user_id','',true)");
      await db.query('SET LOCAL ROLE anon');
      await expect(db.query('select public.qr_customer_history($1)', [branch])).rejects.toThrow();
      await db.query('ROLLBACK TO SAVEPOINT denied');
      await db.query('RESET ROLE');
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
