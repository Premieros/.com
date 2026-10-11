import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const conn = process.env.SUPABASE_DB_URL;
if (!conn) throw new Error('SUPABASE_DB_URL required for DB integration');
type Workbench = {
  success?: boolean;
  error?: string;
  organizations?: Array<{ id: string; name: string }>;
  requests?: Array<{
    id: string;
    organization_id: string;
    status: string;
    proposed: { code: string; name: string };
    source: { code: string; name: string };
    master: unknown;
    stale: boolean;
    requester_name?: string;
  }>;
  candidates?: Array<{
    branch_account_id: string;
    organization_id: string;
    code: string;
    plan_status: string;
    mapping_status: string;
    source: { name: string };
  }>;
};

describe('Architecture V2 Phase 5K secure org account review workbench', () => {
  const db = new Client({ connectionString: conn });
  beforeAll(async () => db.connect());
  afterAll(async () => db.end());

  const authenticate = async (id: string | null) => {
    await db.query("select set_config('app.jwt',$1,true),set_config('app.user_id',$2,true)",
      [id ? JSON.stringify({sub:id,role:'authenticated'}) : '',id ?? '']);
  };

  const setup = async () => {
    const a = {org:randomUUID(),branch:randomUUID(),user:randomUUID()};
    const b = {org:randomUUID(),branch:randomUUID(),user:randomUUID()};
    for (const x of [a,b]) {
      await authenticate(null);
      await db.query(
        "insert into public.organizations(id,name,slug) values($1,'CI 5K Secure CoA',$2)",
        [x.org,`ci5k-${randomUUID().slice(0,8)}`]);
      await db.query(
        "insert into public.branches(id,name,organization_id,is_active) values($1,'CI 5K Branch',$2,true)",
        [x.branch,x.org]);
      const email = `ci5k-${randomUUID().slice(0,8)}@ci.invalid`;
      await db.query('insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())',
        [x.user,email]);
      await db.query("select set_config('app.register_branch','on',true)");
      await db.query(
        "insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,'CI Auditor','accountant',$3,true)",
        [x.user,email,x.branch]);
      await db.query("select set_config('app.register_branch','off',true)");
    }
    const codeA='C5K'+randomUUID().slice(0,9).toUpperCase();
    const codeB='C5K'+randomUUID().slice(0,9).toUpperCase();
    const r=await db.query<{id:string}>(
      `insert into public.chart_of_accounts(branch_id,code,name,account_type,is_system,is_active)
       values($1,$3,'CI Org A Expense','expense',false,true),
             ($2,$4,'CI Org B Expense','expense',false,true)
       returning id,branch_id`,
      [a.branch,b.branch,codeA,codeB],
    );
    const acctA=r.rows.find(x=>(x as typeof x & {branch_id:string}).branch_id===a.branch)?.id;
    if (!acctA) throw new Error('Fixture missing org A account');
    return {a,b,codeA,codeB,acctA};
  };

  const read = async (org: string | null = null) => {
    const {rows}=await db.query<{result:Workbench}>(
      'select public.get_organization_account_sync_workbench_v2($1,100) result',[org]);
    return rows[0].result;
  };

  it('seals read API to authenticated callers only; no private table access', async () => {
    const {rows}=await db.query<{anon:boolean;auth:boolean;service:boolean;private_access:boolean}>(
      `select
        has_function_privilege('anon','public.get_organization_account_sync_workbench_v2(uuid,integer)','EXECUTE') anon,
        has_function_privilege('authenticated','public.get_organization_account_sync_workbench_v2(uuid,integer)','EXECUTE') auth,
        has_function_privilege('service_role','public.get_organization_account_sync_workbench_v2(uuid,integer)','EXECUTE') service,
        has_table_privilege('authenticated','private.organization_account_sync_requests_v2','SELECT') private_access`);
    expect(rows[0]).toEqual({anon:false,auth:true,service:false,private_access:false});
    await db.query('BEGIN');
    try {
      await authenticate(null);
      expect((await read()).error).toBe('AUTH_REQUIRED');
    } finally {await db.query('ROLLBACK');}
  });

  it('isolates organization candidates and denies cross-organization filter', async () => {
    await db.query('BEGIN');
    try {
      const {a,b,codeA,codeB} = await setup();
      await authenticate(a.user);
      const result=await read();
      expect(result.success).toBe(true);
      expect(result.organizations?.some(o=>o.id===a.org)).toBe(true);
      expect(result.organizations?.some(o=>o.id===b.org)).toBe(false);
      expect(result.candidates?.some(o=>o.code===codeA && o.plan_status==='READY')).toBe(true);
      expect(result.candidates?.some(o=>o.code===codeB)).toBe(false);
      expect((await read(b.org)).error).toBe('ORGANIZATION_ACCESS_REQUIRED');
      expect((await read(a.org)).success).toBe(true);
    } finally {await db.query('ROLLBACK');}
  });

  it('shows frozen proposal and live drift without mutating or approving it', async () => {
    await db.query('BEGIN');
    try {
      const f=await setup();
      await authenticate(f.a.user);
      const {rows}=await db.query<{result:{success:boolean;request_id:string}}>(
        'select public.request_organization_account_sync_v2($1,$2) result',
        [f.acctA,'CI 5K demonstrate a frozen proposal']);
      expect(rows[0].result.success).toBe(true);
      const initial=await read(f.a.org);
      const before=initial.requests?.find(r=>r.id===rows[0].result.request_id);
      expect(before?.status).toBe('PENDING');
      expect(before?.stale).toBe(false);
      expect(before?.proposed.name).toBe('CI Org A Expense');

      await authenticate(null);
      await db.query("update public.chart_of_accounts set name='CI Expense changed after proposal' where id=$1",[f.acctA]);
      await authenticate(f.a.user);
      const after=await read(f.a.org);
      const stale=after.requests?.find(r=>r.id===rows[0].result.request_id);
      expect(stale?.proposed.name).toBe('CI Org A Expense');
      expect(stale?.source.name).toBe('CI Expense changed after proposal');
      expect(stale?.stale).toBe(true);
      const {rows:stored}=await db.query<{status:string}>(
        'select status from private.organization_account_sync_requests_v2 where id=$1',
        [rows[0].result.request_id]);
      expect(stored[0].status).toBe('PENDING'); // read never changes request state
    } finally {await db.query('ROLLBACK');}
  });

  it('rejects identities without accounting management permission', async () => {
    await db.query('BEGIN');
    try {
      const f=await setup();
      await authenticate(null);
      await db.query("select set_config('app.register_branch','on',true)");
      await db.query("update public.users set role='cashier' where id=$1",[f.a.user]);
      await db.query("select set_config('app.register_branch','off',true)");
      await authenticate(f.a.user);
      expect((await read()).error).toBe('NOT_AUTHORIZED');
    } finally {await db.query('ROLLBACK');}
  });
});
