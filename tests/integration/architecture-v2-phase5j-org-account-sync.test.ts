import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const conn = process.env.SUPABASE_DB_URL;
if (!conn) throw new Error('SUPABASE_DB_URL is required for integration tests');

type Result = { success?: boolean; error?: string; status?: string; request_id?: string; organization_account_id?: string };
describe('Architecture V2 Phase 5J two-person controlled org account sync', () => {
  const db = new Client({ connectionString: conn });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  const as = async (userId: string | null) => {
    await db.query(
      `select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true)`,
      [userId ?? '', userId ? JSON.stringify({ sub: userId, role: 'authenticated' }) : ''],
    );
  };
  const call = async (sql: string, values: unknown[] = []) => {
    const { rows } = await db.query<{ result: Result }>(sql, values);
    return rows[0]?.result;
  };

  const fixture = async () => {
    const org = randomUUID();
    const branch = randomUUID();
    const proposer = randomUUID();
    const reviewer = randomUUID();
    const code = `CI5J${randomUUID().slice(0, 8).toUpperCase()}`;
    await as(null);
    await db.query(
      'insert into public.organizations(id,name,slug) values($1,$2,$3)',
      [org, 'CI org 5J', `ci-5j-${randomUUID().slice(0, 8)}`],
    );
    await db.query(
      "insert into public.branches(id,name,is_active,organization_id) values($1,'CI 5J Branch',true,$2)",
      [branch, org],
    );
    await db.query(
      `insert into public.roles(role,name_ar,name_en,permissions,scope,is_active)
       values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true)
       on conflict(role) do nothing`,
    );
    for (const [id, label] of [[proposer, 'proposer'], [reviewer, 'reviewer']]) {
      const email = `ci5j-${label}-${randomUUID().slice(0, 8)}@ci.invalid`;
      await db.query('insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())', [id, email]);
      await db.query('select set_config(\'app.register_branch\',\'on\',true)');
      await db.query(
        `insert into public.users(id,email,full_name,role,branch_id,is_active)
         values($1,$2,'CI 5J Actor','super_admin',$3,true)`,
        [id, email, branch],
      );
      await db.query('select set_config(\'app.register_branch\',\'off\',true)');
    }
    const { rows: accounts } = await db.query<{ id: string }>(
      `insert into public.chart_of_accounts(branch_id,code,name,account_type,is_system,is_active)
       values($1,$2,'CI Expense','expense',false,true) returning id`, [branch, code],
    );
    return { org, branch, proposer, reviewer, code, account: accounts[0].id };
  };

  it('exposes only authenticated approval RPCs and seals private request storage', async () => {
    const { rows } = await db.query<{
      rls: boolean; anon_read: boolean; auth_read: boolean; service_read: boolean;
      auth_insert: boolean; service_write: boolean; anon_request: boolean;
      auth_request: boolean; anon_decide: boolean; auth_decide: boolean;
      private_helper_auth: boolean;
    }>(`select
      (select relrowsecurity from pg_class
       where oid='private.organization_account_sync_requests_v2'::regclass) rls,
      has_table_privilege('anon','private.organization_account_sync_requests_v2','SELECT') anon_read,
      has_table_privilege('authenticated','private.organization_account_sync_requests_v2','SELECT') auth_read,
      has_table_privilege('service_role','private.organization_account_sync_requests_v2','SELECT') service_read,
      has_table_privilege('authenticated','private.organization_account_sync_requests_v2','INSERT') auth_insert,
      has_table_privilege('service_role','private.organization_account_sync_requests_v2','UPDATE') service_write,
      has_function_privilege('anon','public.request_organization_account_sync_v2(uuid,text)','EXECUTE') anon_request,
      has_function_privilege('authenticated','public.request_organization_account_sync_v2(uuid,text)','EXECUTE') auth_request,
      has_function_privilege('anon','public.decide_organization_account_sync_v2(uuid,boolean,text)','EXECUTE') anon_decide,
      has_function_privilege('authenticated','public.decide_organization_account_sync_v2(uuid,boolean,text)','EXECUTE') auth_decide,
      has_function_privilege('authenticated','private.organization_account_sync_plan_v2(uuid)','EXECUTE') private_helper_auth`);
    expect(rows[0]).toEqual({
      rls: true, anon_read: false, auth_read: false, service_read: false,
      auth_insert: false, service_write: false, anon_request: false,
      auth_request: true, anon_decide: false, auth_decide: true,
      private_helper_auth: false,
    });
  });

  it('requires two separate authorized users, then links once with append-only audit evidence', async () => {
    await db.query('BEGIN');
    try {
      const f = await fixture();
      await as(f.proposer);
      const pending = await call(
        'select public.request_organization_account_sync_v2($1,$2) result',
        [f.account, 'Link newly created expense account to org identity'],
      );
      expect(pending?.success).toBe(true);
      expect(pending?.status).toBe('PENDING');
      const duplicate = await call(
        'select public.request_organization_account_sync_v2($1,$2) result', [f.account, 'Second proposed link'],
      );
      expect(duplicate?.error).toBe('PENDING_REQUEST_EXISTS');
      const self = await call(
        'select public.decide_organization_account_sync_v2($1,true,$2) result',
        [pending?.request_id, 'Attempt self approval'],
      );
      expect(self?.error).toBe('SELF_APPROVAL_FORBIDDEN');

      const { rows: before } = await db.query<{ status: string }>(
        'select mapping_status status from private.organization_account_link_health_v2 where branch_account_id=$1',
        [f.account],
      );
      expect(before[0]?.status).toBe('UNMAPPED_BRANCH_ACCOUNT');

      await as(f.reviewer);
      const applied = await call(
        'select public.decide_organization_account_sync_v2($1,true,$2) result',
        [pending?.request_id, 'Independent org CoA review'],
      );
      expect(applied?.success).toBe(true);
      expect(applied?.status).toBe('APPLIED');
      const replay = await call(
        'select public.decide_organization_account_sync_v2($1,true,$2) result',
        [pending?.request_id, 'Attempt replay'],
      );
      expect(replay?.error).toBe('REQUEST_ALREADY_DECIDED');
      const { rows: after } = await db.query<{ status: string; entries: string; audit_count: string }>(
        `select
          (select mapping_status from private.organization_account_link_health_v2
           where branch_account_id=$1) status,
          (select count(*)::text from private.organization_account_branch_links_v2
           where branch_account_id=$1) entries,
          (select count(*)::text from public.audit_log
           where entity='organization_account_sync' and entity_id=$2) audit_count`,
        [f.account, pending?.request_id],
      );
      expect(after[0]).toEqual({ status: 'MAPPED_OK', entries: '1', audit_count: '2' });
    } finally {
      // Roll back first: transaction-local config resets itself, including on SQL errors.
      await db.query('ROLLBACK');
    }
  });

  it('invalidates stale proposals and leaves the shadow org CoA untouched', async () => {
    await db.query('BEGIN');
    try {
      const f = await fixture();
      await as(f.proposer);
      const pending = await call(
        'select public.request_organization_account_sync_v2($1,$2) result',
        [f.account, 'Approve exact frozen account identity'],
      );
      expect(pending?.success).toBe(true);
      await as(null);
      await db.query("update public.chart_of_accounts set name='CI Expense Changed' where id=$1", [f.account]);
      await as(f.reviewer);
      const stale = await call(
        'select public.decide_organization_account_sync_v2($1,true,$2) result',
        [pending?.request_id, 'Review stale identity'],
      );
      expect(stale?.error).toBe('STALE_PROPOSAL');
      const { rows } = await db.query<{ status: string; link_count: string }>(
        `select (select status from private.organization_account_sync_requests_v2
          where id=$1) status,
          (select count(*)::text from private.organization_account_branch_links_v2
          where branch_account_id=$2) link_count`, [pending?.request_id, f.account],
      );
      expect(rows[0]).toEqual({ status: 'STALE', link_count: '0' });
    } finally {
      // Roll back first: transaction-local config resets itself, including on SQL errors.
      await db.query('ROLLBACK');
    }
  });

  it('safely refreshes label/active metadata without touching branch account keys', async () => {
    await db.query('BEGIN');
    try {
      const f = await fixture();
      await db.query(
        `insert into private.organization_accounts_v2
         (organization_id,code,name,account_type,is_system,is_active,
           initial_branch_account_count,initial_readiness_status)
         values($1,$2,'CI Expense','expense',false,true,1,'CONSISTENT')`,
        [f.org, f.code],
      );
      await db.query(
        `insert into private.organization_account_branch_links_v2
          (branch_account_id,organization_account_id,organization_id,branch_id)
         select $1,oa.id,$2,$3 from private.organization_accounts_v2 oa
         where oa.organization_id=$2 and oa.code=$4`,
        [f.account, f.org, f.branch, f.code],
      );
      await db.query(
        "update public.chart_of_accounts set name='CI Expense Renamed',is_active=false where id=$1",
        [f.account],
      );
      await as(f.proposer);
      const pending = await call(
        'select public.request_organization_account_sync_v2($1,$2) result',
        [f.account, 'Refresh agreed organization expense label'],
      );
      expect((pending as Result & { operation?: string })?.operation).toBe('REFRESH_LABELS');
      expect(pending?.success).toBe(true);
      await as(f.reviewer);
      const applied = await call(
        'select public.decide_organization_account_sync_v2($1,true,$2) result',
        [pending?.request_id, 'Approve same org label'],
      );
      expect(applied?.success).toBe(true);
      const { rows } = await db.query<{ name: string; is_active: boolean; mapping_status: string }>(
        `select oa.name,oa.is_active,h.mapping_status
         from private.organization_accounts_v2 oa
         join private.organization_account_branch_links_v2 l on l.organization_account_id=oa.id
         join private.organization_account_link_health_v2 h on h.branch_account_id=l.branch_account_id
         where l.branch_account_id=$1`, [f.account],
      );
      expect(rows[0]).toMatchObject({
        name: 'CI Expense Renamed', is_active: false, mapping_status: 'MAPPED_OK',
      });
    } finally {
      // Roll back first: transaction-local config resets itself, including on SQL errors.
      await db.query('ROLLBACK');
    }
  });

  it('requires organization-wide access for requests from a branch-only accountant', async () => {
    await db.query('BEGIN');
    try {
      const f = await fixture();
      await as(null);
      const secondBranch = randomUUID();
      await db.query(
        "insert into public.branches(id,name,is_active,organization_id) values($1,'CI 5J Second Branch',true,$2)",
        [secondBranch, f.org],
      );
      // The existing user-role guard requires a real Super Admin for role changes.
      await as(f.reviewer);
      await db.query(`update public.users set role='accountant' where id=$1`, [f.proposer]);
      await as(f.proposer);
      const result = await call(
        'select public.request_organization_account_sync_v2($1,$2) result',
        [f.account, 'Accountant cannot approve org without all branches'],
      );
      expect(result?.error).toBe('ORGANIZATION_ACCESS_REQUIRED');
    } finally {
      // Roll back first: transaction-local config resets itself, including on SQL errors.
      await db.query('ROLLBACK');
    }
  });

  it('refuses an account-type divergence rather than rewriting a canonical identity', async () => {
    await db.query('BEGIN');
    try {
      const f = await fixture();
      await db.query(
        `insert into private.organization_accounts_v2
         (organization_id,code,name,account_type,is_system,is_active,
           initial_branch_account_count,initial_readiness_status)
         values($1,$2,'CI Expense','expense',false,true,1,'CONSISTENT')`,
        [f.org,f.code],
      );
      await db.query(
        `insert into private.organization_account_branch_links_v2
          (branch_account_id,organization_account_id,organization_id,branch_id)
         select $1,oa.id,$2,$3 from private.organization_accounts_v2 oa
         where oa.organization_id=$2 and oa.code=$4`,
        [f.account,f.org,f.branch,f.code],
      );
      await db.query(
        "update public.chart_of_accounts set account_type='liability' where id=$1",
        [f.account],
      );
      await as(f.proposer);
      const denied = await call(
        'select public.request_organization_account_sync_v2($1,$2) result',
        [f.account, 'Cannot silently transform posted account types'],
      );
      expect(denied?.error).toBe('MANUAL_REVIEW_REQUIRED');
    } finally {
      // Roll back first: transaction-local config resets itself, including on SQL errors.
      await db.query('ROLLBACK');
    }
  });

  it('denies anonymous invocation and preserves all real journal lines', async () => {
    const { rows } = await db.query<{ before_lines: string }>(
      'select count(*)::text before_lines from public.journal_entry_lines',
    );
    await db.query('BEGIN');
    try {
      await as(null);
      const anonymous = await call(
        'select public.request_organization_account_sync_v2($1,$2) result',
        [randomUUID(), 'Anonymous forbidden request'],
      );
      expect(anonymous?.error).toBe('AUTH_REQUIRED');
      const { rows: during } = await db.query<{ lines: string }>(
        'select count(*)::text lines from public.journal_entry_lines',
      );
      expect(during[0]?.lines).toBe(rows[0]?.before_lines);
    } finally {
      // Roll back first: transaction-local config resets itself, including on SQL errors.
      await db.query('ROLLBACK');
    }
  });
});
