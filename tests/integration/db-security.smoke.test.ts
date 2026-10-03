import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
  throw new Error('SUPABASE_DB_URL is required for database integration tests');
}

describe('canonical database integration smoke', () => {
  const client = new Client({ connectionString });

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it('has the core ERP/POS tables after canonical migrations', async () => {
    const expected = [
      'sales',
      'orders',
      'inventory',
      'inventory_ledger',
      'journal_entries',
      'settings',
      'branch_settings',
    ];

    const { rows } = await client.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name = any($1::text[])
       order by table_name`,
      [expected],
    );

    expect(rows.map((row) => row.table_name).sort()).toEqual([...expected].sort());
  });

  it('keeps RLS enabled on sensitive operational and financial tables', async () => {
    const sensitive = ['audit_log', 'inventory', 'journal_entries', 'orders', 'sales', 'users'];

    const { rows } = await client.query<{ table_name: string; rls_enabled: boolean }>(
      `select c.relname as table_name, c.relrowsecurity as rls_enabled
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'
         and c.relname = any($1::text[])
       order by c.relname`,
      [sensitive],
    );

    expect(rows).toHaveLength(sensitive.length);
    expect(rows.every((row) => row.rls_enabled)).toBe(true);
  });

  it('keeps at least one RLS policy on every sensitive table', async () => {
    const sensitive = ['audit_log', 'inventory', 'journal_entries', 'orders', 'sales', 'users'];

    const { rows } = await client.query<{ table_name: string; policy_count: string }>(
      `select tablename as table_name, count(*)::text as policy_count
       from pg_policies
       where schemaname = 'public'
         and tablename = any($1::text[])
       group by tablename
       order by tablename`,
      [sensitive],
    );

    expect(rows).toHaveLength(sensitive.length);
    expect(rows.every((row) => Number(row.policy_count) > 0)).toBe(true);
  });

  it('keeps the sale boundary functions security-definer with an explicit public search_path', async () => {
    const { rows } = await client.query<{
      function_name: string;
      security_definer: boolean;
      config: string[] | null;
    }>(
      `select p.proname as function_name,
              p.prosecdef as security_definer,
              p.proconfig as config
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('process_sale', '_process_sale_core')
       order by p.proname`,
    );

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.security_definer).toBe(true);
      expect((row.config || []).some((value) => value.startsWith('search_path=public'))).toBe(true);
    }
  });
});
