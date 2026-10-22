import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const conn=process.env.SUPABASE_DB_URL;
if(!conn) throw new Error('SUPABASE_DB_URL required');

describe('queued Super Admin organization deletion',()=>{
  const db=new Client({connectionString:conn});
  beforeAll(async()=>{await db.connect();});
  afterAll(async()=>{await db.end();});

  it('requires independent Super Admin, queues once, and worker deletes only confirmed tenant',async()=>{
    const [orgA,orgB,branchA,branchB,adminId,ownerId]=Array.from({length:6},()=>randomUUID());
    const suffix=randomUUID().slice(0,9);
    const nameA='CI queued tenant '+suffix;
    await db.query('BEGIN');
    try {
      await db.query("SELECT set_config('app.register_branch','on',true)");
      await db.query("INSERT INTO public.organizations(id,name,slug,is_active) VALUES($1,$2,$3,true),($4,$5,$6,true)",
        [orgA,nameA,'ci-queued-a-'+suffix,orgB,'CI kept tenant '+suffix,'ci-queued-b-'+suffix]);
      await db.query("INSERT INTO public.branches(id,name,organization_id,is_active) VALUES($1,'Queued branch',$2,true),($3,'Kept branch',$4,true)",
        [branchA,orgA,branchB,orgB]);
      for(const [id,role,branch] of [
        [adminId,'super_admin',branchB],[ownerId,'owner',branchA]
      ]) {
        const mail='ci-queue-'+id.slice(0,8)+'@example.invalid';
        await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",[id,mail]);
        await db.query("INSERT INTO public.users(id,email,full_name,username,role,branch_id,is_active) VALUES($1,$2,'CI test',$3,$4,$5,true)",
          [id,mail,'ci-queue-'+id.slice(0,12),role,branch]);
      }
      await db.query("SELECT set_config('app.register_branch','off',true)");
      await db.query("SELECT set_config('app.user_id',$1,true)",[ownerId]);
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[ownerId]);
      const denied=await db.query<{r:{success:boolean;error?:string}}>(
        "SELECT public.super_admin_queue_organization_deletion($1,$2,'DELETE') r",[orgA,nameA]);
      expect(denied.rows[0].r).toMatchObject({success:false,error:'SUPER_ADMIN_REQUIRED'});

      await db.query("SELECT set_config('app.user_id',$1,true)",[adminId]);
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[adminId]);
      const mismatch=await db.query<{r:{success:boolean;error?:string}}>(
        "SELECT public.super_admin_queue_organization_deletion($1,'Incorrect name','DELETE') r",[orgA]);
      expect(mismatch.rows[0].r).toMatchObject({success:false,error:'ORGANIZATION_NAME_MISMATCH'});
      const queued=await db.query<{r:{success:boolean;job_id:string;status:string}}>(
        "SELECT public.super_admin_queue_organization_deletion($1,$2,'DELETE') r",[orgA,nameA]);
      expect(queued.rows[0].r).toMatchObject({success:true,status:'queued'});
      const duplicate=await db.query<{r:{success:boolean;job_id:string;status:string}}>(
        "SELECT public.super_admin_queue_organization_deletion($1,$2,'DELETE') r",[orgA,nameA]);
      expect(duplicate.rows[0].r.job_id).toBe(queued.rows[0].r.job_id);

      const orgCount=await db.query<{n:number}>(
        'SELECT count(*)::int n FROM public.organizations WHERE id=$1',[orgA]);
      expect(orgCount.rows[0].n).toBe(1); // Queueing itself deletes nothing.

      const claim=await db.query<{n:number}>('SELECT private.claim_organization_deletion_job() n');
      expect(claim.rows[0].n).toBe(1);
      const worked=await db.query<{r:{processed:boolean;success?:boolean;error?:string}}>(
        'SELECT private.execute_claimed_organization_deletion() r');
      expect(worked.rows[0].r,JSON.stringify(worked.rows[0].r)).toMatchObject({
        processed:true,success:true
      });
      const completed=await db.query<{r:{success:boolean;status:string}}>(
        'SELECT public.super_admin_organization_deletion_status($1) r',[orgA]);
      expect(completed.rows[0].r).toMatchObject({success:true,status:'succeeded'});
      const post=await db.query<{a:number;b:number;admin:number;owner:number;ownerAuth:number}>(
        `SELECT (SELECT count(*)::int FROM public.organizations WHERE id=$1) a,
          (SELECT count(*)::int FROM public.organizations WHERE id=$2) b,
          (SELECT count(*)::int FROM public.users WHERE id=$3 AND role='super_admin' AND branch_id IS NULL) admin,
          (SELECT count(*)::int FROM public.users WHERE id=$4) owner,
          (SELECT count(*)::int FROM auth.users WHERE id=$4) "ownerAuth"`,
        [orgA,orgB,adminId,ownerId]);
      expect(post.rows[0]).toMatchObject({a:0,b:1,admin:1,owner:0,ownerAuth:0});
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('exposes no direct queue-table privileges and keeps cron worker internally owned',async()=>{
    const {rows}=await db.query<{
      queue_grant:boolean;status_grant:boolean;job_table_grant:boolean;worker_grant:boolean;timeout:string[];
    }>(`SELECT
      has_function_privilege('authenticated','public.super_admin_queue_organization_deletion(uuid,text,text)','EXECUTE') queue_grant,
      has_function_privilege('authenticated','public.super_admin_organization_deletion_status(uuid)','EXECUTE') status_grant,
      has_table_privilege('authenticated','private.organization_deletion_jobs','SELECT') job_table_grant,
      has_function_privilege('authenticated','private.execute_claimed_organization_deletion()','EXECUTE') worker_grant,
      (SELECT proconfig FROM pg_proc WHERE oid='private.execute_claimed_organization_deletion()'::regprocedure) timeout`);
    expect(rows[0].queue_grant).toBe(true);
    expect(rows[0].status_grant).toBe(true);
    expect(rows[0].job_table_grant).toBe(false);
    expect(rows[0].worker_grant).toBe(false);
    expect(rows[0].timeout).toContain('statement_timeout=8min');
  });
});
