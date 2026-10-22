import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL required');

describe('public trial tenant registration', () => {
  const db = new Client({ connectionString });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('an anonymous visitor can create a fully isolated 14-day tenant and owner account', async () => {
    const suffix = randomUUID().slice(0, 10);
    const email = `ci-new-tenant-${suffix}@example.invalid`;
    const name = `CI Registration ${suffix}`;
    await db.query('BEGIN');
    try {
      await db.query('SET LOCAL ROLE anon');
      const response = await db.query<{ payload: {
        success?: boolean;error?: string;detail?: string;
        organization_id?: string;branch_id?: string;user_id?: string;trial_days?: number;
      } }>(`SELECT public.register_trial_tenant(
        $1,$2,$3,$4,$5,NULL,NULL,NULL,'EGP'
      ) payload`, [name, 'CI New Owner', email, 'CiPassword2026!Safe', 'retail']);
      const payload = response.rows[0].payload;
      expect(payload, JSON.stringify(payload)).toMatchObject({ success: true, trial_days:14 });
      expect(payload.organization_id).toBeTruthy();
      expect(payload.branch_id).toBeTruthy();
      expect(payload.user_id).toBeTruthy();
      await db.query('RESET ROLE');

      const { rows: ownerRows } = await db.query(`
        SELECT u.role,u.branch_id,b.organization_id,om.membership_role,om.is_active
        FROM public.users u JOIN public.branches b ON b.id=u.branch_id
        JOIN public.organization_members om ON om.user_id=u.id AND om.organization_id=b.organization_id
        WHERE u.id=$1
      `, [payload.user_id]);
      expect(ownerRows).toMatchObject([{
        role:'owner',branch_id:payload.branch_id,
        organization_id:payload.organization_id,membership_role:'owner',is_active:true,
      }]);
      const subscriptions = await db.query<{ total:string }>(
        "SELECT count(*)::text total FROM public.subscriptions WHERE tenant_id=$1 AND status='trialing' AND trial_ends_at>now()",
        [payload.organization_id],
      );
      expect(subscriptions.rows[0].total).toBe('1');

      const owners = await db.query<{ total:string }>(
        "SELECT count(*)::text total FROM auth.users WHERE email=$1",[email]);
      expect(owners.rows[0].total).toBe('1');
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
