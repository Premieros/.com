import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const url = process.env.SUPABASE_DB_URL;
const disposable = Boolean(url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname));
(disposable ? describe : describe.skip)('discount manager approval amount authority', () => {
  it('denies a discount exceeding the manager limit even when payload total and amount are lower', async () => {
    const db = new Client({connectionString:url});
    await db.connect();
    const org=randomUUID(),branch=randomUUID(),requester=randomUUID(),manager=randomUUID();
    const tag=randomUUID().slice(0,8);
    await db.query('BEGIN');
    try {
      await db.query("insert into public.roles(role,name_ar,name_en,permissions,scope,is_active) values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true) on conflict(role) do nothing");
      await db.query('insert into public.organizations(id,name,slug) values($1,$2,$3)',[org,'Approval CI',`approval-ci-${tag}`]);
      await db.query('insert into public.branches(id,name,organization_id) values($1,$2,$3)',[branch,'Approval CI',org]);
      await db.query("select set_config('app.register_branch','on',true)");
      for (const id of [requester,manager]) {
        const email=`${id}@ci.invalid`;
        await db.query('insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())',[id,email]);
        await db.query("insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,'Approval CI','super_admin',$3,true)",[id,email,branch]);
      }
      await db.query("select set_config('app.register_branch','off',true)");
      const asUser=async(id:string)=>db.query("select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true)",[id,JSON.stringify({sub:id,role:'authenticated'})]);
      await asUser(manager);
      await db.query("insert into public.approval_policies(scope,branch_id,max_amount,approver_mode,approver_user_id) values('manager:discount',$1,10,'user',$2)",[branch,manager]);
      await asUser(requester);
      const request=async(amount:number)=>{
        const {rows}=await db.query<{result:{success:boolean;request_id:string}}>(
          "select public.request_manager_approval('discount','sale',null,$1::jsonb,'CI approval test') result",
          [JSON.stringify({branch_id:branch,discount_amount:amount,discount_type:'amount',subtotal:100,total:1,amount:1,cart:[{product_id:randomUUID(),unit_name:'piece',quantity:1}]})]);
        expect(rows[0].result.success).toBe(true);
        return rows[0].result.request_id;
      };
      const high=await request(20),low=await request(5);
      await asUser(manager);
      const decide=async(id:string)=>(await db.query<{result:{success:boolean;error?:string}}>(
        'select public.decide_manager_approval($1,true,null) result',[id])).rows[0].result;
      expect(await decide(high)).toMatchObject({success:false,error:'NOT_AUTHORIZED'});
      expect(await decide(low)).toMatchObject({success:true});
      const {rows}=await db.query<{id:string;status:string}>('select id,status from public.approval_requests where id=any($1::uuid[])',[[high,low]]);
      expect(Object.fromEntries(rows.map(row=>[row.id,row.status]))).toEqual({[high]:'pending',[low]:'approved'});
    } finally { await db.query('ROLLBACK'); await db.end(); }
  });
});
