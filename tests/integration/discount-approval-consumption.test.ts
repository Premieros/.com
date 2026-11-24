import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {describe,expect,it} from 'vitest';

const url=process.env.SUPABASE_DB_URL;
const isLocal=Boolean(url&&['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname));
(isLocal?describe:describe.skip)('Discount approval atomic consumption',()=>{
 it('keeps an approved discount after a failed split payment, consumes it on success, and rejects reuse',async()=>{
  const db=new Client({connectionString:url});
  await db.connect();
  const org=randomUUID(),branch=randomUUID(),warehouse=randomUUID(),user=randomUUID(),product=randomUUID();
  const tag=randomUUID().replace(/-/g,'').slice(0,12);
  const email=`ci-split-${tag}@ci.invalid`;
  await db.query('BEGIN');
  try{
   await db.query("insert into public.roles(role,name_ar,name_en,permissions,scope,is_active) values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true) on conflict(role) do nothing");
   await db.query("insert into public.organizations(id,name,slug) values($1,'CI Split Payment',$2)",[org,`ci-split-${tag}`]);
   await db.query("insert into public.branches(id,name,is_active,organization_id) values($1,'CI Split Branch',true,$2)",[branch,org]);
   await db.query("insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())",[user,email]);
   await db.query("select set_config('app.register_branch','on',true)");
   await db.query("insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,'CI Split Owner','super_admin',$3,true)",[user,email,branch]);
   await db.query("select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true),set_config('app.register_branch','off',true)",[user,JSON.stringify({sub:user,role:'authenticated'})]);
   await db.query("insert into public.warehouses(id,name,branch_id,is_active,is_default) values($1,'CI Split WH',$2,true,true)",[warehouse,branch]);
   await db.query("insert into public.branch_settings(branch_id,tax_enabled,tax_rate,allow_negative_stock) values($1,false,0,false) on conflict(branch_id) do update set tax_enabled=false,tax_rate=0,allow_negative_stock=false,updated_at=now()",[branch]);
   await db.query("select public.seed_account_mappings($1)",[branch]);
   await db.query("insert into public.products(id,name,sku,cost_price,sale_price,wholesale_price,is_active,product_type,branch_id) values($1,'CI Split Product',$2,5,20,20,true,'ready',$3)",[product,`CISP-${tag}`,branch]);
   const purchase=await db.query<{result:{success:boolean,error?:string}}>(
     "select public.process_purchase($1,null,$2,$3,25,0,0,25,25,'cash','completed','CI split seed',jsonb_build_array(jsonb_build_object('product_id',$4::text,'quantity',5,'unit_cost',5,'unit_name','piece','batch_number',$5::text))) result",
     [`PUR-SPLIT-${tag}`,branch,warehouse,product,`B-${tag}`]);
   expect(purchase.rows[0].result?.success,JSON.stringify(purchase.rows[0].result)).toBe(true);

   const cashier=randomUUID(),shift=randomUUID();
   const cashierEmail=`ci-cashier-${tag}@ci.invalid`;
   await db.query("update public.roles set permissions=(coalesce(permissions,'[]'::jsonb)-'pos.discount')||'[\"pos.payment.take\"]'::jsonb where role='cashier'");
   await db.query("insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())",[cashier,cashierEmail]);
   await db.query("select set_config('app.register_branch','on',true)");
   await db.query("insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,'CI Cashier','cashier',$3,true)",[cashier,cashierEmail,branch]);
   await db.query("select set_config('app.register_branch','off',true)");
   await db.query("insert into public.shifts(id,branch_id,cashier_id,status,opening_amount) values($1,$2,$3,'open',0)",[shift,branch,cashier]);
   await db.query("insert into public.approval_policies(scope,branch_id,approver_mode,approver_user_id) values('manager:discount',$1,'user',$2)",[branch,user]);
   const asUser=async(id:string)=>db.query("select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true)",[id,JSON.stringify({sub:id,role:'authenticated'})]);
   await asUser(cashier);
   const permission=await db.query<{discount:boolean,pay:boolean}>("select public.can_permission('pos.discount') discount,public.can_permission('pos.payment.take') pay");
   expect(permission.rows[0]).toEqual({discount:false,pay:true});
   const cart=[{product_id:product,quantity:1,unit_name:'piece',discount_amount:0,bonus_quantity:0,modifier_option_ids:[]}];
   const request=await db.query<{result:{success:boolean,request_id:string}}>("select public.request_manager_approval('discount','sale',null,$1::jsonb,'CI discount') result",[JSON.stringify({branch_id:branch,subtotal:20,discount_amount:5,discount_type:'amount',cart})]);
   expect(request.rows[0].result.success).toBe(true);
   const approvalId=request.rows[0].result.request_id;
   await asUser(user);
   const decision=await db.query<{result:{success:boolean}}>("select public.decide_manager_approval($1,true,null) result",[approvalId]);
   expect(decision.rows[0].result.success).toBe(true);
   await asUser(cashier);
   const status=async()=> (await db.query<{status:string}>('select status from public.approval_requests where id=$1',[approvalId])).rows[0].status;
   const settle=async(invoice:string,paid:number)=>(await db.query<{result:{success:boolean,error?:string,sale_id?:string}}>(
    "select public.process_sale_split($1,$2,$3,null,$4,20,5,'amount',0,0,15,$5::jsonb,'completed',$6::jsonb,$7,'takeaway',null,null,1) result",
    [invoice,branch,warehouse,cashier,JSON.stringify([{payment_method:'cash',amount:7},{payment_method:'card',amount:paid-7}]),JSON.stringify(cart),shift])).rows[0].result;
   const contextCount=async()=>Number((await db.query<{count:string}>('select count(*)::text count from private.discount_settlement_context where transaction_id=txid_current()')).rows[0].count);
   const failed=await settle(`FAIL-${tag}`,14);
   expect(failed).toMatchObject({success:false,error:'SPLIT_PAYMENT_TOTAL_MISMATCH'});
   expect(await status()).toBe('approved');
   expect(await contextCount()).toBe(0);
   const unchanged=await db.query<{qty:string,count:string}>("select (select quantity::text from public.inventory where warehouse_id=$1 and product_id=$2) qty,(select count(*)::text from public.sales where branch_id=$3) count",[warehouse,product,branch]);
   expect(Number(unchanged.rows[0].qty)).toBe(5);
   expect(unchanged.rows[0].count).toBe('0');
   const success=await settle(`GOOD-${tag}`,15);
   expect(success.success,JSON.stringify(success)).toBe(true);
   expect(await status()).toBe('consumed');
   expect(await contextCount()).toBe(0);
   expect(await settle(`REUSE-${tag}`,15)).toMatchObject({success:false,error:'MANAGER_APPROVAL_REQUIRED'});
   const final=await db.query<{qty:string,count:string,audit_count:string,journal_delta:string}>(`
    select (select quantity::text from public.inventory where warehouse_id=$1 and product_id=$2) qty,
     (select count(*)::text from public.sales where branch_id=$3) count,
     (select count(*)::text from public.audit_log where entity_id=$4 and action='APPROVAL_CONSUMED') audit_count,
     (select coalesce(sum(l.debit-l.credit),0)::text from public.journal_entry_lines l join public.journal_entries j on j.id=l.journal_entry_id where j.reference_id=$5) journal_delta
   `,[warehouse,product,branch,approvalId,success.sale_id]);
   expect(Number(final.rows[0].qty)).toBe(4);
   expect(final.rows[0].count).toBe('1');
   expect(final.rows[0].audit_count).toBe('1');
   expect(Number(final.rows[0].journal_delta)).toBeCloseTo(0,5);

   // Real PostgreSQL client role cannot write the protected financial column
   // or create its own internal settlement capability.
   const privileges=await db.query<{direct_discount:boolean,forge_context:boolean}>(
     "select has_column_privilege('authenticated','public.sales','discount_amount','UPDATE') direct_discount,has_table_privilege('authenticated','private.discount_settlement_context','INSERT') forge_context");
   expect(privileges.rows[0]).toEqual({direct_discount:false,forge_context:false});
   await db.query('SAVEPOINT client_discount_update');
   await db.query('SET LOCAL ROLE authenticated');
   try {
     await expect(db.query('update public.sales set discount_amount=6 where id=$1',[success.sale_id])).rejects.toMatchObject({code:'42501'});
   } finally { await db.query('ROLLBACK TO SAVEPOINT client_discount_update'); }
   // The trigger itself still rejects unauthorized changes even if a
   // privileged SQL writer reaches the table with cashier auth claims.
   await db.query('SAVEPOINT trigger_discount_update');
   try {
     await expect(db.query('update public.sales set discount_amount=6 where id=$1',[success.sale_id])).rejects.toThrow('DISCOUNT_NOT_ALLOWED');
   } finally { await db.query('ROLLBACK TO SAVEPOINT trigger_discount_update'); }
   expect(await contextCount()).toBe(0);
   expect(Number((await db.query<{discount_amount:string}>('select discount_amount from public.sales where id=$1',[success.sale_id])).rows[0].discount_amount)).toBe(5);
  }finally{await db.query('ROLLBACK');await db.end();}
 });
});
