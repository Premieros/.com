import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL required');

describe('full organization deletion timeout isolation', () => {
  const db = new Client({ connectionString });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('extends only the protected organization deletion function to sixty seconds', async () => {
    const res = await db.query<{
      function_config: string[];
      authenticated_config: string[] | null;
      anonymous_execute: boolean;
    }>(`
      SELECT p.proconfig function_config,
        (SELECT rolconfig FROM pg_roles WHERE rolname='authenticated') authenticated_config,
        has_function_privilege('anon',p.oid,'EXECUTE') anonymous_execute
      FROM pg_proc p
      WHERE p.oid='public.super_admin_delete_organization(uuid,text,text)'::regprocedure
    `);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].function_config).toContain('statement_timeout=60s');
    expect(res.rows[0].authenticated_config ?? []).not.toContain('statement_timeout=60s');
    expect(res.rows[0].anonymous_execute).toBe(false);
  });
});
