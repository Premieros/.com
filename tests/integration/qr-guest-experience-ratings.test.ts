import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.SUPABASE_DB_URL;
const disposable = Boolean(url && ['localhost', '127.0.0.1', '[::1]'].some(host => url.includes(host)));

(disposable ? describe : describe.skip)('Guest QR experience rating permissions', () => {
  const db = new Client({ connectionString: url });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('requires an accepted visit, saves once, isolates another device and grants staff only aggregate branch view', async () => {
    const org = randomUUID(), branch = randomUUID(), table = randomUUID();
    const session = 'a'.repeat(64), otherSession = 'b'.repeat(64);
    const profile = randomUUID(), visit = randomUUID(), request = randomUUID();
    const user = randomUUID(), marker = randomUUID().slice(0, 8);
    await db.query('BEGIN');
    try {
      await db.query(`insert into public.roles(role,name_ar,name_en,permissions,scope,is_active)
        values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true)
        on conflict(role) do nothing`);
      await db.query('insert into public.organizations(id,name,slug) values($1,$2,$3)',
        [org, 'CI QR rating org', `ci-qr-rating-${marker}`]);
      await db.query('insert into public.branches(id,name,organization_id) values($1,$2,$3)',
        [branch, 'CI guest rating branch', org]);
      await db.query('insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())',
        [user, `ci-rating-${marker}@ci.invalid`]);
      await db.query("select set_config('app.register_branch','on',true)");
      await db.query('insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,$3,$4,$5,true)',
        [user, `ci-rating-${marker}@ci.invalid`, 'QR test manager', 'super_admin', branch]);
      await db.query("select set_config('app.user_id',$1,true),set_config('app.register_branch','off',true)",
        [user]);
      await db.query('insert into public.dining_tables(id,branch_id,name) values($1,$2,$3)',
        [table, branch, 'Test Table']);
      const token = (await db.query<{ token: string }>('select public.qr_branch_code($1) token', [branch])).rows[0].token;
      const generation = (await db.query<{ generation: string }>(
        'select generation from qr_private.branch_qr_links where branch_id=$1', [branch])).rows[0].generation;
      await db.query('insert into qr_private.customer_profiles(id,branch_id,phone,name) values($1,$2,$3,$4)',
        [profile, branch, '+201000111222', 'CI Guest']);
      await db.query(`insert into qr_private.visits
        (id,branch_id,generation,profile_id,guest_hash,origin_table_id,order_type,table_id)
        values($1,$2,$3,$4,encode(sha256(convert_to($5,'UTF8')),'hex'),$6,'dine_in',$6)`,
        [visit, branch, generation, profile, session, table]);
      const read = async (sessionValue: string) =>
        (await db.query<{ data: { eligible: boolean; submitted: boolean } }>(
          'select public.qr_guest_rating($1,$2) data', [token, sessionValue])).rows[0].data;
      const rate = async (s: string, score = 5) =>
        (await db.query<{ data: { submitted: boolean; overall: number } }>(
          'select public.qr_guest_rate($1,$2,$3,$4,$5,$6) data',
          [token, s, score, 4, 5, 'Thank you'])).rows[0].data;

      expect(await read(session)).toMatchObject({ eligible: false, submitted: false });
      await db.query(`insert into qr_private.requests
        (id,table_id,requested_table_id,branch_id,generation,request_key,payload,items,visit_id,status)
        values($1,$2,$2,$3,$4,$5,'[]'::jsonb,'[]'::jsonb,$6,'accepted')`,
        [request, table, branch, generation, randomUUID(), visit]);
      expect(await read(session)).toMatchObject({ eligible: true, submitted: false });

      // Act as a guest with no staff identity; only token+session grants rating.
      await db.query("select set_config('app.user_id','',true)");
      await db.query('SET LOCAL ROLE anon');
      expect(await rate(session)).toMatchObject({ submitted: true, overall: 5 });
      expect(await rate(session, 1)).toMatchObject({ submitted: true, overall: 5 });
      expect(await read(session)).toMatchObject({ eligible: true, submitted: true, overall: 5 });

      await db.query('SAVEPOINT invalid_session');
      await expect(rate(otherSession)).rejects.toThrow();
      await db.query('ROLLBACK TO SAVEPOINT invalid_session');
      await db.query('RESET ROLE');
      await db.query("select set_config('app.user_id',$1,true)", [user]);
      expect((await db.query('select count(*)::integer n from qr_private.guest_ratings where visit_id=$1', [visit])).rows[0].n).toBe(1);

      // Only staff with branch scope and pos.view can read ratings.
      const stats = (await db.query<{ data: { count: number; average: number } }>(
        'select public.qr_branch_ratings($1) data',[branch])).rows[0].data;
      expect(stats.count).toBe(1);
      expect(Number(stats.average)).toBe(5);
    } finally { await db.query('ROLLBACK'); }
  });
});
