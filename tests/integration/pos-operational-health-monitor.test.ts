import { randomUUID } from 'node:crypto';
import {Client} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
const url=process.env.SUPABASE_DB_URL;
const local=!!url&&/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//.test(url);
(local?describe:describe.skip)('POS operational health is read-only toward customer business records',()=>{
 const db=new Client({connectionString:url});
 beforeAll(async()=>{await db.connect();});
 afterAll(async()=>{await db.end();});
 it('captures only aggregate review counters, idempotently per 15-minute bucket',async()=>{
  const org=randomUUID(),branch=randomUUID(),tag=randomUUID().slice(0,8);
  await db.query('BEGIN');
  try{
   await db.query("insert into public.organizations(id,name,slug) values($1,'CI POS health',$2)",[org,`ci-pos-health-${tag}`]);
   await db.query("insert into public.branches(id,name,organization_id,is_active) values($1,'CI Health Branch',$2,true)",[branch,org]);
   const record=await db.query<{id:string}>(
    "insert into public.daily_closes(branch_id,business_date,status,closed_at,report_snapshot) values($1,current_date-3,'closed',now(),'{}'::jsonb) returning id",
    [branch]);
   const first=await db.query<{result:{metrics:Array<{metric:string,affected_count:number,status:string}>}}>(
    'select private.capture_pos_operational_health() result');
   expect(first.rows[0].result.metrics).toHaveLength(4);
   const empty=first.rows[0].result.metrics.find(m=>m.metric==='empty_closed_day_snapshot');
   expect(empty?.affected_count).toBeGreaterThanOrEqual(1);
   expect(empty?.status).toBe('review');
   // Snapshot can be repaired by a privileged operator without touching ledger.
   await db.query("update public.daily_closes set report_snapshot=jsonb_build_object('success',true) where id=$1",[record.rows[0].id]);
   const second=await db.query<{result:{metrics:Array<{metric:string,affected_count:number,status:string}>}}>(
    'select private.capture_pos_operational_health() result');
   const fixed=second.rows[0].result.metrics.find(m=>m.metric==='empty_closed_day_snapshot');
   expect(fixed!.affected_count).toBe(empty!.affected_count-1);
   const n=await db.query<{n:string}>("select count(*)::text n from private.pos_operational_health_samples where bucket_start=date_trunc('hour',now())+floor(extract(minute from now())/15)::integer*interval '15 minutes'");
   expect(n.rows[0].n).toBe('4'); // no duplicates after retry
   const grants=await db.query<{anon:boolean,authenticated:boolean}>(
    "select has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated from pg_proc p where p.oid='private.capture_pos_operational_health()'::regprocedure");
   expect(grants.rows[0]).toEqual({anon:false,authenticated:false});
   expect(JSON.stringify(second.rows[0].result)).not.toContain(branch);
   expect(JSON.stringify(second.rows[0].result)).not.toContain(org);
  }finally{await db.query('ROLLBACK');}
 });
});
