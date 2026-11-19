import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
const url=process.env.SUPABASE_DB_URL;
const disposable=!!url&&/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//.test(url);
(disposable?describe:describe.skip)('manual business-day rollover cash snapshot',()=>{
 const db=new Client({connectionString:url});
 beforeAll(async()=>{await db.connect();});
 afterAll(async()=>{await db.end();});
 it('normalizes cash once, preserves open shift, and reuses identical snapshot on historic read',async()=>{
  const org=randomUUID(),branch=randomUUID(),admin=randomUUID(),shift=randomUUID();
  const tag=randomUUID().replace(/-/g,'').slice(0,12),email=`ci-rollover-${tag}@ci.invalid`;
  await db.query('BEGIN');
  try{
   await db.query("insert into public.roles(role,name_ar,name_en,permissions,scope,is_active) values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true) on conflict(role) do nothing");
   await db.query("insert into public.organizations(id,name,slug) values($1,'CI Rollover',$2)",[org,`ci-rollover-${tag}`]);
   await db.query("insert into public.branches(id,name,organization_id,is_active) values($1,'CI Rollover Branch',$2,true)",[branch,org]);
   await db.query("insert into public.branch_settings(branch_id,business_day_mode,business_day_start,business_day_end,auto_close_shift_at_day_end) values($1,'fixed_time','00:00','00:00',false) on conflict(branch_id) do update set business_day_mode='fixed_time',business_day_start='00:00',business_day_end='00:00',auto_close_shift_at_day_end=false",[branch]);
   await db.query("insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())",[admin,email]);
   await db.query("select set_config('app.register_branch','on',true)");
   await db.query("insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,'CI Rollover Admin','super_admin',$3,true)",[admin,email,branch]);
   await db.query("select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true),set_config('app.register_branch','off',true)",[admin,JSON.stringify({sub:admin,role:'authenticated'})]);
   const d=await db.query<{day:string}>("select (now() at time zone 'Africa/Cairo')::date::text day");
   const day=d.rows[0].day;
   await db.query("insert into public.business_day_state(branch_id,business_date,started_at) values($1,$2,now()-interval '10 minutes')",[branch,day]);
   await db.query("insert into public.shifts(id,branch_id,cashier_id,status,opened_at,opening_amount) values($1,$2,$3,'open',now()-interval '10 minutes',0)",[shift,branch,admin]);
   const result=await db.query<{result:{success:boolean,error?:string,report:Record<string,unknown>,daily_close_id:string,rolled_over:boolean,shift_preserved:boolean}}>(
    'select public.rollover_business_day($1) result',[branch]);
   expect(result.rows[0].result?.success,JSON.stringify(result.rows[0].result)).toBe(true);
   expect(result.rows[0].result).toMatchObject({rolled_over:true,shift_preserved:true});
   const snapshot=result.rows[0].result.report;
   expect(snapshot).toMatchObject({
    success:true,
    branch_id:branch,business_date:day,
    cash_source_rule:'branch_cash_only',
    historical_reconciled:false
   });
   const stored=await db.query<{report_snapshot:Record<string,unknown>}>(
    'select report_snapshot from public.daily_closes where id=$1',[result.rows[0].result.daily_close_id]);
   expect(stored.rows[0].report_snapshot).toEqual(snapshot);
   const historic=await db.query<{report:Record<string,unknown>}>(
    'select public.get_day_closing_report($1,$2::date) report',[branch,day]);
   expect(historic.rows[0].report).toMatchObject({...snapshot,
    daily_close_status:'closed',snapshot:true,active_business_day:false});
   expect(historic.rows[0].report.cash_source_rule).toBe('branch_cash_only');
   const active=await db.query<{status:string}>('select status from public.shifts where id=$1',[shift]);
   expect(active.rows[0].status).toBe('open');
  } finally {await db.query('ROLLBACK');}
 });
});
