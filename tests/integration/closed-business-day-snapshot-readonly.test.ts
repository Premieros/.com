import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

// This suite runs only on disposable CI PostgreSQL, never on a customer's
// Supabase project. All fixture rows are rolled back.
const url=process.env.SUPABASE_DB_URL;
const isLocal=!!url&&/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//.test(url);
(isLocal?describe:describe.skip)('sealed business day uses immutable cached snapshot',()=>{
 const db=new Client({connectionString:url});
 beforeAll(async()=>{await db.connect();});
 afterAll(async()=>{await db.end();});
 it('does not normalize closed cash totals or initialize business-day state on historic reads',async()=>{
  const org=randomUUID(),branch=randomUUID(),admin=randomUUID(),day='2026-11-12';
  const tag=randomUUID().replace(/-/g,'').slice(0,12),email=`ci-day-close-${tag}@ci.invalid`;
  const expected={
   success:true,branch_id:branch,business_date:day,
   window_start:'2026-11-12T08:00:00Z',window_end:'2026-11-13T00:00:00Z',
   invoice_count:5,gross_sales:120,cash_sales:70,
   cash_expenses:8,cash_after_outflows:62,payment_methods:[],
  };
  await db.query('BEGIN');
  try {
   await db.query("insert into public.roles(role,name_ar,name_en,permissions,scope,is_active) values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true) on conflict(role) do nothing");
   await db.query("insert into public.organizations(id,name,slug) values($1,'CI Historical Day',$2)",[org,`ci-closed-${tag}`]);
   await db.query("insert into public.branches(id,name,organization_id,is_active) values($1,'CI Historical Branch',$2,true)",[branch,org]);
   await db.query("insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())",[admin,email]);
   await db.query("select set_config('app.register_branch','on',true)");
   await db.query("insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,'CI Super Admin','super_admin',$3,true)",[admin,email,branch]);
   await db.query("select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true),set_config('app.register_branch','off',true)",[admin,JSON.stringify({sub:admin,role:'authenticated'})]);
   const close=await db.query<{id:string}>(
    "insert into public.daily_closes(branch_id,business_date,closed_by,report_snapshot) values($1,$2,$3,$4::jsonb) returning id",
    [branch,day,admin,JSON.stringify(expected)]
   );
   const first=await db.query<{result:Record<string,unknown>}>(
    'select public.get_day_closing_report($1,$2::date) result',[branch,day]
   );
   expect(first.rows[0].result).toMatchObject({...expected,
    daily_close_status:'closed',snapshot:true,active_business_day:false});
   expect(first.rows[0].result.cash_expenses).toBe(8);
   expect(first.rows[0].result.cash_after_outflows).toBe(62);
   const state=await db.query<{count:string}>(
    'select count(*)::text count from public.business_day_state where branch_id=$1',[branch]);
   expect(state.rows[0].count).toBe('0');

   // Opening a newer shift must not turn the prior close into a live report.
   await db.query(
    "insert into public.shifts(id,branch_id,cashier_id,status,opened_at,opening_amount) values($1,$2,$3,'open',now(),0)",
    [randomUUID(),branch,admin]
   );
   const after=await db.query<{result:Record<string,unknown>}>(
    'select public.get_day_closing_report($1,$2::date) result',[branch,day]);
   expect(after.rows[0].result).toEqual(first.rows[0].result);
   const retry=await db.query<{result:Record<string,unknown>}>(
    'select public._finalize_day_close($1,$2::date,$3) result',[branch,day,admin]);
   expect(retry.rows[0].result).toMatchObject({
    success:true,already_closed:true,daily_close_id:close.rows[0].id,
    report:expected
   });
   const closeCount=await db.query<{count:string}>(
    'select count(*)::text count from public.daily_closes where branch_id=$1 and business_date=$2::date',
    [branch,day]);
   expect(closeCount.rows[0].count).toBe('1');

   // A two-day historical range must use saved snapshots directly, without
   // initializing the current business-day state or recasting cash expenses.
   const day2='2026-11-13';
   const next={...expected,business_date:day2,gross_sales:80,net_sales:80,
     invoice_count:2,cash_after_outflows:50,
     payment_methods:[{method:'cash',sales_total:50},{method:'card',sales_total:30}]};
   await db.query(
    "insert into public.daily_closes(branch_id,business_date,closed_by,report_snapshot) values($1,$2,$3,$4::jsonb)",
    [branch,day2,admin,JSON.stringify(next)]
   );
   const firstRange=await db.query<{report:{rows:Array<Record<string,unknown>>}}>(
    'select public.get_day_closing_range_report($1,$2::date,$3::date) report',
    [branch,day,day2]
   );
   expect(firstRange.rows[0].report.rows).toHaveLength(2);
   const rows=firstRange.rows[0].report.rows;
   expect(rows[0]).toMatchObject({business_date:day,gross_sales:120,invoice_count:5,snapshot:true,daily_close_status:'closed'});
   expect(rows[1]).toMatchObject({business_date:day2,gross_sales:80,net_sales:80,invoice_count:2,cash:50,card:30,snapshot:true,daily_close_status:'closed'});
   const stateAfterRange=await db.query<{count:string}>(
    'select count(*)::text count from public.business_day_state where branch_id=$1',[branch]);
   expect(stateAfterRange.rows[0].count).toBe('0');
   const secondRange=await db.query<{report:{rows:Array<Record<string,unknown>>}}>(
    'select public.get_day_closing_range_report($1,$2::date,$3::date) report',
    [branch,day,day2]
   );
   expect(secondRange.rows[0].report.rows).toEqual(rows);

  } finally {await db.query('ROLLBACK');}
 });
});
