import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL is required');

describe('super admin guarded organization hard delete', () => {
  const db = new Client({ connectionString });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('blocks anonymous callers even when an organization ID is known', async () => {
    const result = await db.query<{ data: { success: boolean; error: string } }>(
      "SELECT public.super_admin_preview_organization_deletion($1) as data",
      [randomUUID()],
    );
    expect(result.rows[0].data).toMatchObject({ success: false, error: 'SUPER_ADMIN_REQUIRED' });
  });

  it('removes only an inactive empty-history organization and its dedicated auth users', async () => {
    const adminOrg = randomUUID();
    const adminBranch = randomUUID();
    const adminId = randomUUID();
    const targetOrg = randomUUID();
    const targetBranch = randomUUID();
    const targetUser = randomUUID();
    const slug = randomUUID().slice(0, 8);
    const targetName = 'CI disposable ' + slug;

    await db.query('BEGIN');
    try {
      await db.query("SELECT set_config('app.register_branch','on',true)");
      await db.query("INSERT INTO public.organizations(id,name,slug,is_active) VALUES($1,$2,$3,true)",
        [adminOrg, 'CI protected ' + slug, 'ci-pr-' + slug]);
      await db.query("INSERT INTO public.branches(id,name,organization_id,is_active) VALUES($1,$2,$3,true)",
        [adminBranch, 'CI protected branch', adminOrg]);
      await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)",
        [adminId, 'ci-admin-' + slug + '@example.invalid']);
      await db.query("INSERT INTO public.users(id,email,full_name,username,role,branch_id,is_active) VALUES ($1,$2,'CI System Admin',$3,'super_admin',$4,true)",
        [adminId, 'ci-admin-' + slug + '@example.invalid', 'ci-admin-' + slug, adminBranch]);

      await db.query("INSERT INTO public.organizations(id,name,slug,is_active) VALUES($1,$2,$3,false)",
        [targetOrg,targetName,'ci-del-' + slug]);
      await db.query("INSERT INTO public.branches(id,name,organization_id,is_active) VALUES($1,$2,$3,true)",
        [targetBranch,'CI disposable branch',targetOrg]);
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",
        [targetUser,'ci-target-' + slug + '@example.invalid']);
      await db.query("INSERT INTO public.users(id,email,full_name,username,role,branch_id,is_active) VALUES($1,$2,'CI Test Owner',$3,'owner',$4,true)",
        [targetUser,'ci-target-' + slug + '@example.invalid','ci-target-' + slug,targetBranch]);

      await db.query("SELECT set_config('app.user_id',$1,true)",[adminId]);
      const preview = await db.query<{ data: {
        success:boolean; eligible:boolean; branches:number; users:number; blockers: unknown[];
      } }>(
        "SELECT public.super_admin_preview_organization_deletion($1) data", [targetOrg]);
      expect(preview.rows[0].data.success).toBe(true);
      expect(preview.rows[0].data.blockers).toEqual([]);
      expect(preview.rows[0].data.eligible).toBe(true);
      expect(preview.rows[0].data.branches).toBe(1);
      expect(preview.rows[0].data.users).toBe(1);

      const wrongName = await db.query<{ data: { success:boolean;error:string } }>(
        "SELECT public.super_admin_delete_empty_organization($1,$2,'DELETE') data", [targetOrg,'wrong']);
      expect(wrongName.rows[0].data.error).toBe('ORGANIZATION_NAME_MISMATCH');

      const result = await db.query<{ data: { success:boolean;deleted:boolean;auth_accounts_deleted:number } }>(
        "SELECT public.super_admin_delete_empty_organization($1,$2,'DELETE') data", [targetOrg,targetName]);
      expect(result.rows[0].data).toMatchObject({
        success:true,deleted:true,auth_accounts_deleted:1,
      });

      const { rows: post } = await db.query<{
        target_org: number;target_branch:number;target_user:number;target_auth:number;protected_org:number;protected_user:number; receipt:number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM public.organizations WHERE id=$1) target_org,
          (SELECT count(*)::int FROM public.branches WHERE id=$2) target_branch,
          (SELECT count(*)::int FROM public.users WHERE id=$3) target_user,
          (SELECT count(*)::int FROM auth.users WHERE id=$3) target_auth,
          (SELECT count(*)::int FROM public.organizations WHERE id=$4) protected_org,
          (SELECT count(*)::int FROM public.users WHERE id=$5) protected_user,
          (SELECT count(*)::int FROM private.organization_deletion_receipts WHERE organization_id=$1) receipt
      `,[targetOrg,targetBranch,targetUser,adminOrg,adminId]);
      expect(post[0]).toMatchObject({
        target_org:0,target_branch:0,target_user:0,target_auth:0,
        protected_org:1,protected_user:1,receipt:1,
      });

      const activePreview = await db.query<{ data: { eligible:boolean;blockers:string[] } }>(
        'SELECT public.super_admin_preview_organization_deletion($1) data',[adminOrg]);
      expect(activePreview.rows[0].data.eligible).toBe(false);
      expect(activePreview.rows[0].data.blockers).toContain('ORGANIZATION_ACTIVE');
      expect(activePreview.rows[0].data.blockers).toContain('CURRENT_USER_BELONGS_TO_ORGANIZATION');
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
