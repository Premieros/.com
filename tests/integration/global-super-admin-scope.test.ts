import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL required');

describe('platform super admin identity', () => {
  const db = new Client({ connectionString });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('super admins are not tied to a branch, even if legacy bootstrap supplies one', async () => {
    const userId = randomUUID(),orgId=randomUUID(),branchId=randomUUID(),slug=randomUUID().slice(0,9);
    await db.query('BEGIN');
    try {
      await db.query("SELECT set_config('app.register_branch','on',true)");
      await db.query("INSERT INTO public.organizations(id,name,slug) VALUES($1,'CI global scope',$2)",[orgId,'ci-global-'+slug]);
      await db.query("INSERT INTO public.branches(id,name,organization_id) VALUES($1,'CI test branch',$2)",[branchId,orgId]);
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",[userId,'ci-global-'+slug+'@example.invalid']);
      await db.query(`INSERT INTO public.users(id,email,username,full_name,branch_id,role,is_active)
        VALUES($1,$2,$3,'CI Platform Admin',$4,'super_admin',true)`,
        [userId,'ci-global-'+slug+'@example.invalid','ci-global-'+slug,branchId]);
      const res=await db.query<{role:string;branch_id:string|null}>(
        'SELECT role,branch_id FROM public.users WHERE id=$1',[userId]);
      expect(res.rows[0]).toEqual({role:'super_admin',branch_id:null});
    } finally {
      await db.query('ROLLBACK');
    }
  });
  it('creates organization trial access and enables the selected modules for the new owner', async () => {
    const admin = randomUUID();
    const suffix = randomUUID().slice(0, 9);
    const email = `trial-owner-${suffix}@example.invalid`;
    await db.query('BEGIN');
    try {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [admin, `trial-admin-${suffix}@example.invalid`]);
      await db.query("SELECT set_config('app.register_branch','on',true)");
      await db.query(`INSERT INTO public.users(id,email,full_name,role,is_active)
        VALUES($1,$2,'CI Admin','super_admin',true)`, [admin, `trial-admin-${suffix}@example.invalid`]);
      const setActor = (id: string) => db.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.jwt',$2,true),set_config('app.register_branch','off',true)",
        [id, JSON.stringify({ sub: id, role: 'authenticated' })],
      );
      await setActor(admin);
      const { rows: [created] } = await db.query(`SELECT public.super_admin_create_organization_from_profile(
        $1,'restaurant',$2,ARRAY['pos','inventory','catalog'],'{}'::jsonb,'CI Owner',$3,$4
      ) AS result`, [`CI Trial ${suffix}`, `CI Branch ${suffix}`, email, randomUUID()]);
      expect(created.result).toMatchObject({ success: true, trial_days: 14 });
      const { rows: [trial] } = await db.query(
        "SELECT status, trial_ends_at > now() AS valid FROM public.subscriptions WHERE tenant_id=$1",
        [created.result.organization_id],
      );
      expect(trial).toEqual({ status: 'trialing', valid: true });
      await setActor(created.result.owner_user_id);
      const { rows } = await db.query(
        "SELECT feature_key,enabled FROM public.get_organization_module_catalog($1) WHERE feature_key IN ('inventory','catalog','accounting')",
        [created.result.organization_id],
      );
      expect(Object.fromEntries(rows.map(row => [row.feature_key, row.enabled])))
        .toEqual({ inventory: true, catalog: true, accounting: false });
    } finally {
      await db.query('ROLLBACK');
    }
  });

});
