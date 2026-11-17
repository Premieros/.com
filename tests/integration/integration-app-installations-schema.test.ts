import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error('SUPABASE_DB_URL required for disposable integration tests');

describe('central integration catalog registry (disposable database only)', () => {
  const db = new Client({ connectionString: dbUrl });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('enables and forces RLS and prevents anonymous access', async () => {
    const { rows } = await db.query<{
      rls: boolean; force_rls: boolean; anon_select: boolean;
      anon_insert: boolean; auth_select: boolean; auth_update: boolean;
    }>(`select c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
      has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
      has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
      has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
      has_table_privilege('authenticated', c.oid, 'UPDATE') as auth_update
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'integration_app_installations'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rls: true, force_rls: true, anon_select: false,
      anon_insert: false, auth_select: true, auth_update: false,
    });
  });

  it('restricts writes to guarded insert/delete policies and known apps', async () => {
    const { rows: policies } = await db.query<{ policyname: string; cmd: string }>(
      `select policyname, cmd from pg_policies
       where schemaname = 'public' and tablename = 'integration_app_installations'`,
    );
    expect(policies.map(({ cmd }) => cmd).sort()).toEqual(['DELETE', 'INSERT', 'SELECT']);
    expect(policies.map(({ policyname }) => policyname).sort()).toEqual([
      'integration_app_delete', 'integration_app_insert', 'integration_app_read',
    ]);
    const { rows: checks } = await db.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
       where conrelid = 'public.integration_app_installations'::regclass and contype = 'c'`,
    );
    expect(checks.some(({ definition }) =>
      definition.includes('eta-einvoice') && definition.includes('talabat') &&
      definition.includes('jahez'))).toBe(true);
  });

  it('limits platform admins to active users with explicit branch access in the single policies', async () => {
    const { rows } = await db.query<{ policyname: string; expression: string }>(`
      select policyname,
        coalesce(qual, '') || ' ' || coalesce(with_check, '') as expression
      from pg_policies
      where schemaname = 'public'
        and tablename = 'integration_app_installations'
      order by policyname
    `);
    expect(rows).toHaveLength(3);
    for (const { expression } of rows) {
      expect(expression).toContain('organization_members');
      expect(expression).toContain('super_admin');
      expect(expression).toContain('user_branch_access');
      expect(expression).toContain('a.branch_id = integration_app_installations.branch_id');
      expect(expression).toContain('u.is_active');
      expect(expression).toContain('auth.uid()');
    }
    expect(rows.find((row) => row.policyname === 'integration_app_insert')?.expression)
      .toContain('installed_by');
  });

  it('rejects a branch from a different organization before install', async () => {
    const { randomUUID } = await import('node:crypto');
    const orgA = randomUUID(), orgB = randomUUID(), branch = randomUUID();
    const nameSuffix = randomUUID().slice(0, 8);
    await db.query('BEGIN');
    try {
      await db.query(
        "insert into public.organizations(id,name,slug) values($1,'CI Apps A',$3),($2,'CI Apps B',$4)",
        [orgA, orgB, `ci-app-a-${nameSuffix}`, `ci-app-b-${nameSuffix}`],
      );
      await db.query(
        "insert into public.branches(id,name,organization_id) values($1,'CI Apps Branch',$2)",
        [branch, orgA],
      );
      // Invalid installed_by would also violate a FK, but the BEFORE trigger must
      // reject the mismatched branch/organization first.
      await db.query('SAVEPOINT invalid_scope');
      await expect(db.query(
        `insert into public.integration_app_installations
         (organization_id,branch_id,app_id,installed_by) values($1,$2,'talabat',$3)`,
        [orgB, branch, randomUUID()],
      )).rejects.toThrow(/INTEGRATION_BRANCH_ORGANIZATION_MISMATCH/);
      await db.query('ROLLBACK TO SAVEPOINT invalid_scope');
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
