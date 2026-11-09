import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL required for isolated tenant tests');

/**
 * Logical tenant-scale isolation regression, NOT a throughput or 120 concurrent
 * user benchmark. Entire fixture is rolled back on disposable CI PostgreSQL.
 */
describe('120 organization branch access isolation', () => {
  const db = new Client({ connectionString });
  beforeAll(async () => db.connect());
  afterAll(async () => db.end());

  it('keeps separate owners isolated across 120 organizations and permits the second branch of their own organization', async () => {
    const orgIds = Array.from({ length: 120 }, () => randomUUID());
    const branchIds = Array.from({ length: 120 }, () => randomUUID());
    const secondBranchA = randomUUID();
    const [ownerA, ownerB] = [randomUUID(), randomUUID()];
    const token = randomUUID().slice(0, 12);

    await db.query('BEGIN');
    try {
      await db.query("SELECT set_config('app.register_branch','on',true)");
      await db.query(
        `INSERT INTO public.organizations(id,name,slug)
         SELECT o.id,'CI scale organization ' || o.ordinality::text,o.slug
         FROM unnest($1::uuid[], $2::text[]) WITH ORDINALITY AS o(id,slug,ordinality)`,
        [orgIds, orgIds.map((_, i) => `ci-scale-${token}-${i}`)],
      );
      await db.query(
        `INSERT INTO public.branches(id,organization_id,name,is_active)
         SELECT b.branch,b.org,'CI scale branch ' || b.ordinality::text,true
         FROM unnest($1::uuid[], $2::uuid[]) WITH ORDINALITY AS b(branch,org,ordinality)`,
        [branchIds, orgIds],
      );
      await db.query(
        "INSERT INTO public.branches(id,organization_id,name,is_active) VALUES ($1,$2,'CI second authorized branch',true)",
        [secondBranchA, orgIds[0]],
      );

      for (const [user, branch, label] of [[ownerA, branchIds[0], 'a'], [ownerB, branchIds[1], 'b']] as const) {
        const email = `ci-scale-owner-${label}-${token}@example.invalid`;
        await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [user, email]);
        await db.query(
          `INSERT INTO public.users(id,role,branch_id,email,full_name,username,is_active)
           VALUES($1,'owner',$2,$3,'CI Scale Owner',$4,true)`,
          [user, branch, email, `ci-scale-${label}-${token}`],
        );
      }
      await db.query("SELECT set_config('app.register_branch','off',true)");
      const count = await db.query<{ n: string }>(
        'SELECT count(*)::text n FROM public.branches WHERE id=ANY($1::uuid[])',
        [branchIds],
      );
      expect(Number(count.rows[0].n)).toBe(120);

      // Test every synthetic organization through Premier's real branch
      // permission helper, not a hard-coded test-only authorization model.
      await db.query("SELECT set_config('app.user_id',$1,true)", [ownerA]);
      const first = await db.query<{ branch_id: string; can_access: boolean }>(
        `SELECT b.branch_id, public.user_may_access_branch(b.branch_id) can_access
         FROM unnest($1::uuid[]) AS b(branch_id)`,
        [[...branchIds, secondBranchA]],
      );
      expect(first.rows).toHaveLength(121);
      expect(first.rows.filter(r => r.can_access).map(r => r.branch_id).sort())
        .toEqual([branchIds[0], secondBranchA].sort());
      expect(first.rows.filter(r => !r.can_access)).toHaveLength(119);

      await db.query('SAVEPOINT forbidden_grant');
      await expect(
        db.query('INSERT INTO public.user_branch_access(user_id,branch_id) VALUES($1,$2)', [ownerA, branchIds[2]]),
      ).rejects.toThrow(/OWNER_CROSS_ORGANIZATION_BRANCH_ACCESS_FORBIDDEN/);
      await db.query('ROLLBACK TO SAVEPOINT forbidden_grant');

      await db.query("SELECT set_config('app.user_id',$1,true)", [ownerB]);
      const second = await db.query<{ branch_id: string; can_access: boolean }>(
        `SELECT b.branch_id, public.user_may_access_branch(b.branch_id) can_access
         FROM unnest($1::uuid[]) AS b(branch_id)`,
        [[...branchIds, secondBranchA]],
      );
      expect(second.rows.filter(r => r.can_access).map(r => r.branch_id)).toEqual([branchIds[1]]);
      expect(second.rows.filter(r => !r.can_access)).toHaveLength(120);
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
