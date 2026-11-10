import { it,describe,beforeEach,afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes,randomUUID } from 'node:crypto';
import { buildRuntimeProposal } from './history-closeout-runtime.mjs';
import { finalEvidence,formatFinalThreeSQL,buildFinalThreeProposal } from './history-closeout-final3.mjs';
const url=process.env.HISTORY55_TEST_DB_URL;
if(process.env.CI) assert.ok(url,'CI database required');
if(url) assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname));
it('separates scheduler activation from installation',async()=>{
  const p=await buildRuntimeProposal();assert.equal(p.schedulerActivation,null);
  assert.equal(p.installation,await readFile(new URL('./history-closeout-runtime_INSTALL_ONLY_NOT_A_MIGRATION.sql',import.meta.url),'utf8'));
  assert.ok(!p.installation.includes('cron.schedule('));
  const active=await buildRuntimeProposal({activateScheduler:true});
  assert.ok(active.schedulerActivation.includes("'auto-business-day-close'"));
  assert.equal(active.schedulerActivation,await readFile(new URL('./history-closeout-runtime_SCHEDULER_REQUIRES_SEPARATE_APPROVAL.sql',import.meta.url),'utf8'));
  assert.equal(active.schedulingChangesBusinessData,true);
});
it('pins the final-three acknowledgement artifact',async()=>{
  assert.equal(await buildFinalThreeProposal(),await readFile(new URL('./history-closeout-final3_ACK_ONLY_NOT_A_MIGRATION.sql',import.meta.url),'utf8'));
});
describe('runtime closeout on disposable PostgreSQL',{skip:!url},()=>{
  let admin,db,database,before,proposal;
  beforeEach(async()=>{
    const {Client}=await import('pg');admin=new Client({connectionString:url});await admin.connect();
    database='closeout_'+randomBytes(8).toString('hex');await admin.query(`CREATE DATABASE ${database}`);
    const u=new URL(url);u.pathname='/'+database;db=new Client({connectionString:u.href});await db.connect();
    before=JSON.parse(await readFile(new URL('../../../docs/database/migration-history-audit-20261110/CLOSEOUT_RUNTIME_BEFORE.json',import.meta.url),'utf8'));
    await db.query(`DO $$ BEGIN
      IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
      END $$;
      CREATE SCHEMA app_private; CREATE SCHEMA private;
      CREATE TABLE public.users(id uuid PRIMARY KEY,username text,email text,failed_attempts integer DEFAULT 0,is_locked boolean DEFAULT false,lock_until timestamptz);
      CREATE TABLE public.organizations(id uuid PRIMARY KEY,is_active boolean);
      CREATE TABLE public.branches(id uuid PRIMARY KEY,organization_id uuid,is_active boolean);
      CREATE TABLE public.branch_settings(branch_id uuid PRIMARY KEY,business_day_start time,business_day_end time,business_day_mode text);
      CREATE TABLE public.business_day_state(branch_id uuid PRIMARY KEY,business_date date,started_at timestamptz,updated_at timestamptz);
      CREATE TABLE public.daily_closes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),branch_id uuid,business_date date,status text,closed_at timestamptz,closed_by uuid,report_snapshot jsonb,UNIQUE(branch_id,business_date));
      CREATE TABLE public.business_sentinel(id integer PRIMARY KEY,value text);
      INSERT INTO public.business_sentinel VALUES(1,'unchanged');
      SET check_function_bodies=off;
      CREATE FUNCTION public._ensure_business_day_state(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('business_date',business_date) FROM public.business_day_state WHERE branch_id=$1 $$;
      CREATE FUNCTION public._next_unclosed_business_date(uuid,date) RETURNS date LANGUAGE sql AS $$ SELECT $2 $$;
      CREATE FUNCTION public._build_day_closing_report(uuid,date) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN IF current_setting('test.close_fail',true)='yes' THEN RAISE EXCEPTION 'TEST_REPORT_FAILED'; END IF; RETURN jsonb_build_object('ci_only',true); END $$;
      CREATE FUNCTION private.normalize_day_close_cash(jsonb,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT $1 $$;`);
    const reportBefore=JSON.parse(await readFile(new URL('../../../docs/database/migration-history-audit-20261110/CLOSEOUT_REPORT_BEFORE.json',import.meta.url),'utf8'));
    for(const f of [...before.functions,{...reportBefore,schema:'public',proname:'_build_day_closing_report',arguments:'p_branch_id uuid, p_business_date date'}]) {
      await db.query(f.definition);
      const signature=f.schema+'.'+f.proname+'('+f.arguments.split(', ').filter(Boolean).map(a=>a.slice(a.indexOf(' ')+1)).join(',')+')';
      await db.query('REVOKE ALL ON FUNCTION '+signature+' FROM PUBLIC,anon,authenticated,service_role');
      for(const entry of f.acl.slice(1,-1).split(',')) {
        const role=entry.split('=')[0];if(role!=='postgres') await db.query('GRANT EXECUTE ON FUNCTION '+signature+' TO '+role);
      }
    }
    proposal=await buildRuntimeProposal();
  });
  afterEach(async()=>{if(db) await db.end();if(admin){await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);await admin.end();}});
  const install=async()=>{await db.query('BEGIN');try{await db.query(proposal.installation);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}};
  const stubReport=async()=>{await db.query(`CREATE OR REPLACE FUNCTION public._build_day_closing_report(p_branch_id uuid,p_business_date date) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN IF current_setting('test.close_fail',true)='yes' THEN RAISE EXCEPTION 'TEST_REPORT_FAILED'; END IF; RETURN jsonb_build_object('ci_only',true); END $$`);};
  const branch=async(mode='fixed_time',active=true)=>{
    const org=randomUUID(),id=randomUUID();
    await db.query('INSERT INTO public.organizations VALUES($1,true)',[org]);
    await db.query('INSERT INTO public.branches VALUES($1,$2,$3)',[id,org,active]);
    await db.query("INSERT INTO public.branch_settings VALUES($1,'00:00','00:00',$2)",[id,mode]);
    await db.query("INSERT INTO public.business_day_state VALUES($1,(now() AT TIME ZONE 'Africa/Cairo')::date-1,now()-interval '2 days',now())",[id]);return id;
  };
  const finalFixture=async()=>{
    await install();await db.query(`SET timezone='UTC';
      CREATE TABLE public.schema_migrations(id bigserial PRIMARY KEY,version text NOT NULL UNIQUE,name text NOT NULL,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
      CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
      CREATE SCHEMA cron;CREATE TABLE cron.job(jobname text,schedule text,active boolean,command text,username text,database text);
      INSERT INTO public.schema_migrations(version,name,checksum) VALUES('unrelated','unrelated.sql','keep');
      INSERT INTO cron.job VALUES('auto-business-day-close','* * * * *',true,'SELECT private.run_due_business_day_closes();','postgres',current_database());`);
    const d=await finalEvidence();
    d.m.baseline.custom_rows=1;d.m.baseline.history_rows=0;
    d.m.baseline.custom_fingerprint=(await db.query("SELECT md5(coalesce(string_agg(md5(row_to_json(x)::text),'' ORDER BY id),'')) AS h FROM public.schema_migrations x")).rows[0].h;
    d.m.baseline.history_fingerprint='d41d8cd98f00b204e9800998ecf8427e';
    for(const f of d.m.candidates)await db.query('INSERT INTO public.schema_migrations(version,name,checksum) VALUES($1,$2,$3)',[f.version,f.name,f.canonical_sha256]);
    const p=await buildRuntimeProposal({activateScheduler:true});
    for(const [i,sql] of [p.installation,p.schedulerActivation].entries())await db.query('INSERT INTO supabase_migrations.schema_migrations VALUES($1,$2,$3)',['runtime_'+i,d.history[i].name,[sql]]);
    return d;
  };
  const finalRun=async(d)=>{try{await db.query(formatFinalThreeSQL(d));}catch(e){await db.query('ROLLBACK');throw e;}};
  it('installs without changing business rows and preserves KDS function body',async()=>{
    const id=await branch();await install();
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM public.daily_closes')).rows[0].n),0);
    assert.deepEqual((await db.query('TABLE public.business_sentinel')).rows,[{id:1,value:'unchanged'}]);
    assert.ok((await db.query('SELECT business_date<(now() AT TIME ZONE \'Africa/Cairo\')::date AS old FROM public.business_day_state WHERE branch_id=$1',[id])).rows[0].old);
    const r=(await db.query("SELECT has_function_privilege('authenticated','public.complete_stale_kitchen_orders(uuid)','EXECUTE') AS auth,has_function_privilege('service_role','public.complete_stale_kitchen_orders(uuid)','EXECUTE') AS service,encode(sha256(convert_to(pg_get_functiondef('public.complete_stale_kitchen_orders(uuid)'::regprocedure),'UTF8')),'hex') AS sha")).rows[0];
    assert.equal(r.auth,false);assert.equal(r.service,true);assert.equal(r.sha,before.functions.find(f=>f.proname==='complete_stale_kitchen_orders').sha256);
  });
  it('counts username and email failures, locks at five, and does not extend active lock',async()=>{
    await install();const id=randomUUID();await db.query("INSERT INTO public.users(id,username,email) VALUES($1,'ci_user','ci_user@ci.invalid')",[id]);
    await db.query("SELECT public.record_login_failure(' CI_USER@CI.INVALID ')");
    assert.equal((await db.query('SELECT failed_attempts FROM public.users')).rows[0].failed_attempts,1);
    for(let i=0;i<4;i++) await db.query("SELECT public.record_login_failure('ci_user')");
    const first=(await db.query('TABLE public.users')).rows[0];assert.equal(first.is_locked,true);assert.equal(first.failed_attempts,5);
    await db.query("SELECT public.record_login_failure('ci_user@ci.invalid')");assert.deepEqual((await db.query('TABLE public.users')).rows[0],first);
  });
  it('resets expired lock to first failure and ignores blank/unknown identifiers',async()=>{
    await install();await db.query("INSERT INTO public.users VALUES($1,'ci_user','ci_user@ci.invalid',7,true,now()-interval '1 minute')",[randomUUID()]);
    await db.query("SELECT public.record_login_failure('ci_user@ci.invalid')");
    const first=(await db.query('TABLE public.users')).rows[0];assert.equal(first.is_locked,false);assert.equal(first.failed_attempts,1);assert.equal(first.lock_until,null);
    await db.query("SELECT public.record_login_failure(NULL);SELECT public.record_login_failure(' ');SELECT public.record_login_failure('missing')");
    assert.deepEqual((await db.query('TABLE public.users')).rows[0],first);
  });
  it('closes only eligible fixed-time branches, records system attribution, and retries idempotently',async()=>{
    const eligible=await branch();await branch('manual');await branch('fixed_time',false);await install();await stubReport();
    const r=(await db.query('SELECT private.run_due_business_day_closes() AS r')).rows[0].r;
    assert.equal(r.success,true);assert.equal(r.closed_count,1);
    const rows=(await db.query('TABLE public.daily_closes')).rows;assert.equal(rows.length,1);assert.equal(rows[0].branch_id,eligible);assert.equal(rows[0].closed_by,null);
    assert.equal((await db.query('SELECT private.run_due_business_day_closes() AS r')).rows[0].r.closed_count,0);
  });
  it('rolls back state advancement and close creation when report building fails',async()=>{
    await branch();await install();await stubReport();const state=(await db.query('TABLE public.business_day_state')).rows;
    await db.query("SET test.close_fail='yes'");const r=(await db.query('SELECT private.run_due_business_day_closes() AS r')).rows[0].r;
    assert.equal(r.success,false);assert.equal(r.errors.length,1);assert.deepEqual((await db.query('TABLE public.business_day_state')).rows,state);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM public.daily_closes')).rows[0].n),0);
  });
  it('rejects preflight function drift atomically',async()=>{
    await db.query("CREATE OR REPLACE FUNCTION public.record_login_failure(p_username text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$");
    await assert.rejects(install(),/CLOSEOUT_FUNCTION_DRIFT/);
    assert.equal((await db.query("SELECT to_regprocedure('private.run_due_business_day_closes()') AS f")).rows[0].f,null);
  });
  it('rejects unexpected widened privileges before changing functions',async()=>{
    await db.query('GRANT EXECUTE ON FUNCTION public.complete_stale_kitchen_orders(uuid) TO anon');
    await assert.rejects(install(),/CLOSEOUT_ACL_DRIFT/);
    assert.equal((await db.query("SELECT to_regprocedure('private.run_due_business_day_closes()') AS f")).rows[0].f,null);
  });
  it('acknowledges final three only after runtime history, active scheduler and all 147 records, then retries',async()=>{
    const d=await finalFixture();await finalRun(d);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.schema_migrations')).rows[0].n,151);
    await finalRun(d);assert.equal((await db.query('SELECT count(*)::int AS n FROM public.schema_migrations')).rows[0].n,151);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.daily_closes')).rows[0].n,0);
  });
  it('refuses final acknowledgement if scheduling is not active',async()=>{
    const d=await finalFixture();await db.query('DELETE FROM cron.job');await assert.rejects(finalRun(d),/FINAL3_SCHEDULER_NOT_ACTIVE/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.schema_migrations')).rows[0].n,148);
  });
  it('refuses final acknowledgement if the earlier metadata batch is incomplete',async()=>{
    const d=await finalFixture();await db.query('DELETE FROM public.schema_migrations WHERE version=$1',[d.m.candidates[146].version]);await assert.rejects(finalRun(d),/FINAL3_147_INCOMPLETE/);
  });
  it('refuses final acknowledgement if actual runtime migration evidence is missing',async()=>{
    const d=await finalFixture();await db.query('DELETE FROM supabase_migrations.schema_migrations');await assert.rejects(finalRun(d),/FINAL3_RUNTIME_HISTORY_MISSING/);
  });
  it('rejects a changed live search_path before final acknowledgement',async()=>{
    const d=await finalFixture();await db.query('ALTER FUNCTION private.run_due_business_day_closes() SET search_path=public');await assert.rejects(finalRun(d),/FINAL3_FUNCTION_DRIFT/);
  });
});
