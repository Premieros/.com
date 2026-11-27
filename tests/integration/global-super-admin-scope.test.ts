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
});
