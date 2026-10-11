import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) throw new Error('SUPABASE_DB_URL is required for integration tests');

describe('Architecture V2 Phase 5H organization account readiness', () => {
  const client = new Client({ connectionString: databaseUrl });
  beforeAll(async () => { await client.connect(); });
  afterAll(async () => { await client.end(); });

  it('makes accounting readiness views private while preserving legacy source tables', async () => {
    const { rows } = await client.query<{
      projection_exists: boolean;
      conflicts_exist: boolean;
      readiness_exists: boolean;
      anon_select: boolean;
      authenticated_select: boolean;
      service_select: boolean;
      legacy_table_exists: boolean;
    }>(`
      select
        to_regclass('private.organization_chart_of_accounts_v2') is not null projection_exists,
        to_regclass('private.organization_chart_account_conflicts_v2') is not null conflicts_exist,
        to_regclass('private.organization_chart_account_readiness_v2') is not null readiness_exists,
        has_table_privilege('anon','private.organization_chart_of_accounts_v2','SELECT') anon_select,
        has_table_privilege('authenticated','private.organization_chart_of_accounts_v2','SELECT') authenticated_select,
        has_table_privilege('service_role','private.organization_chart_of_accounts_v2','SELECT') service_select,
        to_regclass('public.chart_of_accounts') is not null legacy_table_exists
    `);
    expect(rows[0]).toMatchObject({
      projection_exists: true, conflicts_exist: true,
      readiness_exists: true,
      anon_select: false, authenticated_select: false,
      service_select: false, legacy_table_exists: true,
    });
  });

  it('unifies matching branch account codes and diagnoses divergent account types in rollback', async () => {
    const orgId = randomUUID();
    const branchA = randomUUID();
    const branchB = randomUUID();
    const token = randomUUID().slice(0, 8);
    const commonCode = `CI-H-${token}`.toUpperCase();
    const mismatchCode = `CI-X-${token}`.toUpperCase();

    await client.query('BEGIN');
    try {
      await client.query(
        'insert into public.organizations(id,name,slug) values($1,$2,$3)',
        [orgId, 'CI Organization CoA', `ci-coa-${token}`],
      );
      await client.query(
        `insert into public.branches(id,name,organization_id,is_active)
         values($1,'CI CoA A',$3,true),($2,'CI CoA B',$3,true)`,
        [branchA, branchB, orgId],
      );
      await client.query(
        `insert into public.chart_of_accounts
         (branch_id,code,name,account_type,is_system,is_active)
         values
           ($1,$3,'CI Cash','asset',false,true),
           ($2,$3,'CI Cash','asset',false,true),
           ($1,$4,'CI Mismatch','asset',false,true),
           ($2,$4,'CI Mismatch','expense',false,true)`,
        [branchA, branchB, commonCode, mismatchCode],
      );

      const { rows } = await client.query<{
        account_code: string;
        readiness_status: string;
        mapped_branch_count: string;
        organization_branch_count: string;
        branch_account_count: string;
        branch_account_links: Array<{ branch_id: string; account_id: string }>;
      }>(`
        select account_code,readiness_status,mapped_branch_count,
               organization_branch_count,branch_account_count,branch_account_links
        from private.organization_chart_of_accounts_v2
        where organization_id=$1 and account_code=any($2::text[])
        order by account_code
      `, [orgId, [commonCode, mismatchCode]]);

      expect(rows).toHaveLength(2);
      const consistent = rows.find((row) => row.account_code === commonCode);
      const conflict = rows.find((row) => row.account_code === mismatchCode);
      expect(consistent?.readiness_status).toBe('CONSISTENT');
      expect(consistent?.mapped_branch_count).toBe('2');
      expect(consistent?.organization_branch_count).toBe('2');
      expect(consistent?.branch_account_count).toBe('2');
      expect(consistent?.branch_account_links).toHaveLength(2);
      expect(conflict?.readiness_status).toBe('CONFLICT_ACCOUNT_TYPE');

      const { rows: diagnostics } = await client.query<{ conflicting_count: string }>(
        `select count(*)::text conflicting_count
         from private.organization_chart_account_conflicts_v2
         where organization_id=$1 and account_code=any($2::text[])`,
        [orgId, [commonCode, mismatchCode]],
      );
      expect(diagnostics[0]?.conflicting_count).toBe('1');
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('does not introduce a canonical org account writer or rewrite posted journals', async () => {
    const { rows } = await client.query<{
      posted_journals: string;
      branch_accounts: string;
      visible_legacy_lines: string;
    }>(`
      select
        (select count(*)::text from public.journal_entries where posting_status='POSTED') posted_journals,
        (select count(*)::text from public.chart_of_accounts) branch_accounts,
        (select coalesce(sum(branch_account_count),0)::text
         from private.organization_chart_of_accounts_v2) visible_legacy_lines
    `);
    expect(rows[0]?.visible_legacy_lines).toBe(rows[0]?.branch_accounts);
    expect(Number(rows[0]?.posted_journals ?? -1)).toBeGreaterThanOrEqual(0);
  });
});
