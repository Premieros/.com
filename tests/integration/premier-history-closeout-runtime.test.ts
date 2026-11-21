import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Client} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
const url=process.env.SUPABASE_DB_URL;
const local=!!url&&['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
const reportPatch=readFileSync('scripts/db/candidates/history-closeout-report-cutoff_NOT_A_MIGRATION.sql','utf8');
(local?describe:describe.skip)('history closeout on canonical disposable schema',()=>{
  const db=new Client({connectionString:url});
  beforeAll(async()=>{await db.connect();});afterAll(async()=>{await db.end();});
  async function branch(mode='fixed_time'){
    const org=randomUUID(),id=randomUUID();
    await db.query("INSERT INTO public.organizations(id,name,slug,is_active) VALUES($1,'CI Closeout Org',$2,true)",[org,'ci-closeout-'+org]);
    await db.query("INSERT INTO public.branches(id,name,organization_id,is_active) VALUES($1,'CI Closeout Branch',$2,true)",[id,org]);
    await db.query("INSERT INTO public.branch_settings(branch_id,business_day_mode,business_day_start,business_day_end) VALUES($1,$2,'00:00','23:59') ON CONFLICT(branch_id) DO UPDATE SET business_day_mode=excluded.business_day_mode,business_day_start=excluded.business_day_start,business_day_end=excluded.business_day_end",[id,mode]);
    await db.query("INSERT INTO public.business_day_state(branch_id,business_date,started_at) VALUES($1,(now() AT TIME ZONE 'Africa/Cairo')::date-1,now()-interval '2 days') ON CONFLICT(branch_id) DO UPDATE SET business_date=excluded.business_date,started_at=excluded.started_at",[id]);
    return id;
  }
  async function user(branchId:string){
    const id=randomUUID(),tag=id.replace(/-/g,'').slice(0,12),email='ci-closeout-'+tag+'@ci.invalid',role='ci_closeout_'+tag;
    await db.query("INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active) VALUES($1,'CI','CI','[]'::jsonb,'branch',true)",[role]);
    await db.query('INSERT INTO auth.users(id,email,created_at,updated_at) VALUES($1,$2,now(),now())',[id,email]);
    await db.query("SELECT set_config('app.register_branch','on',true)");
    await db.query("INSERT INTO public.users(id,email,full_name,role,branch_id,is_active,username) VALUES($1,$2,'CI Closeout User',$3,$4,true,$5)",[id,email,role,branchId,'ci_'+tag]);
    await db.query("SELECT set_config('app.register_branch','off',true)");return {id,email};
  }
  it('builds a real daily-close snapshot, advances state, preserves shifts/orders and retries',async()=>{
    await db.query('BEGIN');
    try{
      const id=await branch();
      await db.query(reportPatch);
      const before=(await db.query("SELECT (SELECT md5(coalesce(string_agg(row_to_json(s)::text,'' ORDER BY id),'')) FROM public.shifts s) AS shifts,(SELECT md5(coalesce(string_agg(row_to_json(o)::text,'' ORDER BY id),'')) FROM public.orders o) AS orders")).rows[0];
      const r=(await db.query('SELECT private.run_due_business_day_closes() AS r')).rows[0].r;
      const ownErrors=r.errors.filter((e:{branch_id:string})=>e.branch_id===id);
      expect(ownErrors).toEqual([]);
      const closes=(await db.query('SELECT status,closed_by,report_snapshot FROM public.daily_closes WHERE branch_id=$1',[id])).rows;
      expect(closes).toHaveLength(1);expect(closes[0].status).toBe('closed');expect(closes[0].closed_by).toBeNull();expect(closes[0].report_snapshot).toBeTruthy();
      expect((await db.query("SELECT business_date=(now() AT TIME ZONE 'Africa/Cairo')::date AS advanced FROM public.business_day_state WHERE branch_id=$1",[id])).rows[0].advanced).toBe(true);
      await db.query('SELECT private.run_due_business_day_closes()');expect((await db.query('SELECT count(*)::int AS n FROM public.daily_closes WHERE branch_id=$1',[id])).rows[0].n).toBe(1);
      expect((await db.query("SELECT (SELECT md5(coalesce(string_agg(row_to_json(s)::text,'' ORDER BY id),'')) FROM public.shifts s) AS shifts,(SELECT md5(coalesce(string_agg(row_to_json(o)::text,'' ORDER BY id),'')) FROM public.orders o) AS orders")).rows[0]).toEqual(before);
    }finally{await db.query('ROLLBACK');}
  });
  it('does not close shift-span branches',async()=>{
    await db.query('BEGIN');try{const id=await branch('shift_span');await db.query('SELECT private.run_due_business_day_closes()');expect((await db.query('SELECT count(*)::int AS n FROM public.daily_closes WHERE branch_id=$1',[id])).rows[0].n).toBe(0);}finally{await db.query('ROLLBACK');}
  });
  it('keeps a rolled-over historical snapshot at its cutoff while the cashier shift remains open',async()=>{
    await db.query('BEGIN');try{
      const id=await branch(),cashier=await user(id),shift=randomUUID();
      await db.query("INSERT INTO public.shifts(id,branch_id,cashier_id,opened_at,status,opening_amount) VALUES($1,$2,$3,(((now() AT TIME ZONE 'Africa/Cairo')::date-1)::timestamp+time '00:00') AT TIME ZONE 'Africa/Cairo','open',0)",[shift,id,cashier.id]);
      const dates=(await db.query("SELECT (now() AT TIME ZONE 'Africa/Cairo')::date-1 AS day,((((now() AT TIME ZONE 'Africa/Cairo')::date-1)::timestamp+time '23:59') AT TIME ZONE 'Africa/Cairo') AS cutoff")).rows[0];
      await db.query("UPDATE public.business_day_state SET business_date=(now() AT TIME ZONE 'Africa/Cairo')::date,started_at=$2 WHERE branch_id=$1",[id,dates.cutoff]);
      const old=(await db.query('SELECT public._build_day_closing_report($1,$2) AS r',[id,dates.day])).rows[0].r;
      expect(new Date(old.window_end).getTime()).toBeGreaterThan(new Date(dates.cutoff).getTime());
      await db.query("UPDATE public.business_day_state SET business_date=$2,started_at=(SELECT opened_at FROM public.shifts WHERE id=$3) WHERE branch_id=$1",[id,dates.day,shift]);
      await db.query(reportPatch);const result=(await db.query('SELECT private.run_due_business_day_closes() AS r')).rows[0].r;
      expect(result.errors.filter((e:{branch_id:string})=>e.branch_id===id)).toEqual([]);
      const close=(await db.query('SELECT report_snapshot FROM public.daily_closes WHERE branch_id=$1 AND business_date=$2',[id,dates.day])).rows[0];expect(close).toBeTruthy();
      expect(new Date(close.report_snapshot.window_end).getTime()).toBe(new Date(dates.cutoff).getTime());
      expect((await db.query('SELECT status,closed_at FROM public.shifts WHERE id=$1',[shift])).rows[0]).toEqual({status:'open',closed_at:null});
    }finally{await db.query('ROLLBACK');}
  });
  it('protects email login failures on the actual users schema',async()=>{
    await db.query('BEGIN');try{
      const branchId=await branch('shift_span'),{id,email}=await user(branchId);
      await db.query('SET LOCAL ROLE anon');
      for(let i=0;i<5;i++)await db.query('SELECT public.record_login_failure($1)',[email.toUpperCase()]);
      await db.query('RESET ROLE');
      const first=(await db.query('SELECT failed_attempts,is_locked,lock_until FROM public.users WHERE id=$1',[id])).rows[0];expect(first.failed_attempts).toBe(5);expect(first.is_locked).toBe(true);
      await db.query('SET LOCAL ROLE anon');await db.query('SELECT public.record_login_failure($1)',[email]);await db.query('RESET ROLE');expect((await db.query('SELECT failed_attempts,is_locked,lock_until FROM public.users WHERE id=$1',[id])).rows[0]).toEqual(first);
    }finally{await db.query('ROLLBACK');}
  });
});
