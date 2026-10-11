import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL is required for integration tests');

describe('Architecture V2 Phase 5I organization-owned shadow CoA', () => {
  const client = new Client({ connectionString });

  beforeAll(async () => { await client.connect(); });
  afterAll(async () => { await client.end(); });

  it('seals all organization account and identity-link tables from API roles', async () => {
    const { rows } = await client.query<{
      master_exists: boolean;
      links_exist: boolean;
      account_rls: boolean;
      mapping_rls: boolean;
      anon_select: boolean;
      auth_select: boolean;
      service_select: boolean;
      auth_insert: boolean;
      service_update: boolean;
      anon_health: boolean;
      auth_health: boolean;
    }>(`
      select
        to_regclass('private.organization_accounts_v2') is not null as master_exists,
        to_regclass('private.organization_account_branch_links_v2') is not null as links_exist,
        (select relrowsecurity from pg_class where oid='private.organization_accounts_v2'::regclass)
          as account_rls,
        (select relrowsecurity from pg_class where oid='private.organization_account_branch_links_v2'::regclass)
          as mapping_rls,
        has_table_privilege('anon','private.organization_accounts_v2','SELECT') anon_select,
        has_table_privilege('authenticated','private.organization_accounts_v2','SELECT') auth_select,
        has_table_privilege('service_role','private.organization_accounts_v2','SELECT') service_select,
        has_table_privilege('authenticated','private.organization_accounts_v2','INSERT') auth_insert,
        has_table_privilege('service_role','private.organization_account_branch_links_v2','UPDATE') service_update,
        has_table_privilege('anon','private.organization_account_link_health_v2','SELECT') anon_health,
        has_table_privilege('authenticated','private.organization_account_mapping_summary_v2','SELECT') auth_health
    `);
    expect(rows[0]).toEqual({
      master_exists: true, links_exist: true, account_rls: true, mapping_rls: true,
      anon_select: false, auth_select: false, service_select: false,
      auth_insert: false, service_update: false, anon_health: false, auth_health: false,
    });
  });

  it('bootstraps one organization identity per org and code without rewriting branch account keys', async () => {
    const { rows } = await client.query<{
      source_accounts: string;
      linked_accounts: string;
      unmatched: string;
      duplicate_master_codes: string;
      orphaned: string;
      master_codes: string;
      h_codes: string;
      legacy_journal_refs: string;
    }>(`
      select
        (select count(*)::text from public.chart_of_accounts) source_accounts,
        (select count(*)::text from private.organization_account_branch_links_v2) linked_accounts,
        (select count(*)::text from private.organization_account_link_health_v2
         where mapping_status<>'MAPPED_OK') unmatched,
        (select count(*)::text from (
           select organization_id,code
           from private.organization_accounts_v2
           group by 1,2 having count(*)>1
         ) d) duplicate_master_codes,
        (select count(*)::text
         from private.organization_account_branch_links_v2 m
         join public.chart_of_accounts a on a.id=m.branch_account_id
         join public.branches b on b.id=a.branch_id
         join private.organization_accounts_v2 oa on oa.id=m.organization_account_id
         where oa.organization_id<>b.organization_id
            or a.code<>oa.code or a.account_type<>oa.account_type
            or m.branch_id<>a.branch_id) orphaned,
        (select count(*)::text from private.organization_accounts_v2) master_codes,
        (select count(*)::text from private.organization_chart_of_accounts_v2) h_codes,
        (select count(*)::text from public.journal_entry_lines jl
         left join public.chart_of_accounts a on a.id=jl.account_id
         where a.id is null) legacy_journal_refs
    `);
    expect(rows[0].source_accounts).toBe(rows[0].linked_accounts);
    expect(rows[0].master_codes).toBe(rows[0].h_codes);
    expect(rows[0].unmatched).toBe('0');
    expect(rows[0].duplicate_master_codes).toBe('0');
    expect(rows[0].orphaned).toBe('0');
    expect(rows[0].legacy_journal_refs).toBe('0');
  });

  it('flags subsequent branch account inserts as unmapped, never guesses their parent, and rolls back', async () => {
    const organizationId = randomUUID();
    const branchId = randomUUID();
    const code = `CI5I${randomUUID().slice(0, 8).toUpperCase()}`;
    await client.query('BEGIN');
    try {
      await client.query(
        "insert into public.organizations(id,name) values($1,'CI Organization Identity')",
        [organizationId],
      );
      await client.query(
        "insert into public.branches(id,name,organization_id) values($1,'CI Account Branch',$2)",
        [branchId,organizationId],
      );
      const { rows: inserted } = await client.query<{ id: string }>(
        `insert into public.chart_of_accounts(branch_id,code,name,account_type,is_system,is_active)
         values($1,$2,'CI Later Account','expense',false,true) returning id`,
        [branchId,code],
      );
      const { rows: health } = await client.query<{ mapping_status: string }>(
        `select mapping_status from private.organization_account_link_health_v2
         where branch_account_id=$1`,
        [inserted[0].id],
      );
      expect(health[0].mapping_status).toBe('UNMAPPED_BRANCH_ACCOUNT');
      const { rows: master } = await client.query<{ n: string }>(
        `select count(*)::text n from private.organization_accounts_v2
         where organization_id=$1 and code=$2`, [organizationId,code],
      );
      expect(master[0].n).toBe('0');
      const { rows: orgHealth } = await client.query<{ divergent_branch_accounts: string }>(
        `select divergent_branch_accounts from private.organization_account_mapping_summary_v2
         where organization_id=$1`,[organizationId],
      );
      expect(Number(orgHealth[0].divergent_branch_accounts)).toBeGreaterThan(0);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
