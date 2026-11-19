import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
const url=process.env.SUPABASE_DB_URL;
const local=!!url&&/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//.test(url);
(local?describe:describe.skip)('global operational health history RPC authorization',()=>{
 const db=new Client({connectionString:url});
 beforeAll(async()=>{await db.connect();});
 afterAll(async()=>{await db.end();});
 it('returns only aggregates to active global super-admin; rejects branch manager, anonymous and foreign identities',async()=>{
  const admin=randomUUID(),manager=randomUUID(),branch=randomUUID(),org=randomUUID();
  const tag=randomUUID().slice(0,8);
  await db.query('BEGIN');
  try{
   await db.query("insert into public.organizations(id,name,slug) values($1,'CI Health Scope',$2)",[org,`ci-health-scope-${tag}`]);
   await db.query("insert into public.branches(id,name,organization_id,is_active) values($1,'CI Health Branch',$2,true)",[branch,org]);
   await db.query("select set_config('app.register_branch','on',true)");
   await db.query("insert into auth.users(id,email) values($1,$2),($3,$4)",[admin,`ci-global-${tag}@invalid.test`,manager,`ci-manager-${tag}@invalid.test`]);
   await db.query("insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,'CI Global','super_admin',null,true),($3,$4,'CI Manager','branch_manager',$5,true)",
    [admin,`ci-global-${tag}@invalid.test`,manager,`ci-manager-${tag}@invalid.test`,branch]);
   await db.query("select set_config('app.register_branch','off',true)");
   await db.query("insert into private.pos_operational_health_samples(bucket_start,metric_code,category,affected_count,status,window_start,window_end) values(date_trunc('hour',now()),'split_tender_mismatch','transaction_integrity',2,'review',now()-interval '1 hour',now()) on conflict(bucket_start,metric_code) do update set affected_count=2,status='review'");
   const run=async(id:string)=>{
    await db.query("select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true)",[id,JSON.stringify({sub:id,role:'authenticated'})]);
    await db.query('SET LOCAL ROLE authenticated');
    let data;
    try{data=(await db.query("select public.get_pos_operational_health_recent(1) result")).rows[0].result;}
    finally{await db.query('RESET ROLE');}
    return data;
   };
   const denied=await run(manager);
   expect(denied).toMatchObject({success:false,error:'PERMISSION_DENIED'});
   const allowed=await run(admin);
   expect(allowed).toMatchObject({success:true,global_scope:true,sample_interval_minutes:15});
   expect(allowed.rows).toEqual(expect.arrayContaining([expect.objectContaining({
     metric:'split_tender_mismatch',status:'review',affected_count:2,
   })]));
   const text=JSON.stringify(allowed);
   expect(text).not.toContain(admin);expect(text).not.toContain(manager);expect(text).not.toContain(org);
   expect(text).not.toContain(branch);
   await db.query("select set_config('app.user_id','',true),set_config('app.jwt','{}',true)");
   const anon=(await db.query('select public.get_pos_operational_health_recent(1) result')).rows[0].result;
   expect(anon).toMatchObject({success:false,error:'PERMISSION_DENIED'});
   const grants=(await db.query("select has_function_privilege('anon','public.get_pos_operational_health_recent(integer)','EXECUTE') anonymous,has_function_privilege('authenticated','public.get_pos_operational_health_recent(integer)','EXECUTE') authenticated")).rows[0];
   expect(grants).toEqual({anonymous:false,authenticated:true});
  }finally{await db.query('ROLLBACK');}
 });
});
