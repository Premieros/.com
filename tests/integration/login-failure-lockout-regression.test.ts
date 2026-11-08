import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL required');

describe('Login lockout remains effective for both username and email', () => {
  const db = new Client({ connectionString });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('increments by email, locks on 5 failures, and resets only after expiry', async () => {
    const orgId = randomUUID();
    const branchId = randomUUID();
    const userId = randomUUID();
    const suffix = randomUUID().slice(0, 10);
    const email = `ci-lockout-${suffix}@example.invalid`;
    const username = `ci-lockout-${suffix}`;

    // All fixtures and function calls are rolled back, never changing business data.
    await db.query('BEGIN');
    try {
      await db.query("SELECT set_config('app.register_branch','on',true)");
      await db.query(
        "INSERT INTO public.organizations(id,name,slug) VALUES($1,'CI login lockout',$2)",
        [orgId, `ci-login-lockout-${suffix}`],
      );
      await db.query(
        "INSERT INTO public.branches(id,organization_id,name,is_active) VALUES($1,$2,'CI branch',true)",
        [branchId, orgId],
      );
      await db.query(
        "INSERT INTO auth.users(id,email) VALUES($1,$2)",
        [userId, email],
      );
      await db.query(
        `INSERT INTO public.users(id,role,branch_id,email,full_name,username,is_active)
         VALUES($1,'cashier',$2,$3,'CI login tester',$4,true)`,
        [userId, branchId, email, username],
      );

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const { rows } = await db.query<{ success: boolean }>(
          "SELECT (app_private.record_login_failure($1)->>'success')::boolean AS success",
          [email.toUpperCase()],
        );
        expect(rows[0].success).toBe(true);
      }

      const { rows: lockedRows } = await db.query<{ failed_attempts: number; is_locked: boolean; lock_active: boolean }>(
        'SELECT failed_attempts,is_locked,lock_until>now() AS lock_active FROM public.users WHERE id=$1',
        [userId],
      );
      expect(lockedRows[0]).toMatchObject({
        failed_attempts: 5,
        is_locked: true,
        lock_active: true,
      });

      await db.query('SELECT app_private.record_login_failure($1)', [username]);
      const { rows: stillLocked } = await db.query<{ failed_attempts: number }>(
        'SELECT failed_attempts FROM public.users WHERE id=$1',
        [userId],
      );
      expect(stillLocked[0].failed_attempts).toBe(5);

      await db.query(
        "UPDATE public.users SET lock_until=now()-interval '1 minute' WHERE id=$1",
        [userId],
      );
      await db.query('SELECT app_private.record_login_failure($1)', [username]);
      const { rows: afterExpiry } = await db.query<{ failed_attempts: number; is_locked: boolean }>(
        'SELECT failed_attempts,is_locked FROM public.users WHERE id=$1',
        [userId],
      );
      expect(afterExpiry[0]).toMatchObject({ failed_attempts: 1, is_locked: false });
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
