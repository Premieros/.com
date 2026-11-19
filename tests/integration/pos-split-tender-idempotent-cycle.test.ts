import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

// A disposable CI PostgreSQL transaction only, never the customer production DB.
const url=process.env.SUPABASE_DB_URL;
const isLocal=!!url&&/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//.test(url);
(isLocal?describe:describe.skip)('POS split-tender durable DB scenario',()=>{
 const db=new Client({connectionString:url});
 beforeAll(async()=>{await db.connect();});
 afterAll(async()=>{await db.end();});
 it('posts cash+card once, balances the sale journal, rejects mismatched tender and idempotency collisions',async()=>{
  const org=randomUUID(),branch=randomUUID(),warehouse=randomUUID(),user=randomUUID(),product=randomUUID();
  const tag=randomUUID().replace(/-/g,'').slice(0,12),key='sale:'+randomUUID();
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
   const invoice=`SPLIT-${tag}`;
   const items=JSON.stringify([{product_id:product,quantity:1,unit_name:'piece',discount_amount:0,modifier_option_ids:[]}]);
   const payments=JSON.stringify([{payment_method:'cash',amount:8},{payment_method:'card',amount:12}]);
   const sql=`select public.process_sale_split_idempotent(
     $1,$2,$3,$4,null,$5,20,0,'amount',0,0,20,$6::jsonb,'completed',$7::jsonb,
     null,'takeaway',null,null,1) result`;
   const params=[key,invoice,branch,warehouse,user,payments,items];
   // No sale and no inventory deduction when split collections do not match.
   const invalid=await db.query<{result:{success?:boolean,error?:string}}>(sql,
    ['sale:'+randomUUID(),`BAD-${tag}`,branch,warehouse,user,
     JSON.stringify([{payment_method:'cash',amount:8},{payment_method:'card',amount:11}]),items]);
   expect(invalid.rows[0].result?.success).not.toBe(true);
   expect(invalid.rows[0].result?.error).toBe('SPLIT_PAYMENT_TOTAL_MISMATCH');
   const initial=await db.query<{result:{success?:boolean,error?:string,sale_id?:string}}>(sql,params);
   expect(initial.rows[0].result?.success,JSON.stringify(initial.rows[0].result)).toBe(true);
   const saleId=initial.rows[0].result.sale_id;
   expect(saleId).toBeTruthy();
   const retry=await db.query<{result:{success?:boolean,idempotent_replay?:boolean,sale_id?:string}}>(sql,params);
   expect(retry.rows[0].result).toMatchObject({success:true,idempotent_replay:true,sale_id:saleId});
   const changed=await db.query<{result:{success?:boolean,error?:string}}>(sql,
    [key,invoice,branch,warehouse,user,JSON.stringify([{payment_method:'cash',amount:9},{payment_method:'card',amount:11}]),items]);
   expect(changed.rows[0].result).toMatchObject({success:false,error:'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'});
   const rows=await db.query<{sale_count:string,tender_count:string,tender_sum:string,stock_qty:string,journal_delta:string}>(`
     select
      (select count(*)::text from public.sales where branch_id=$1 and invoice_number=$2) sale_count,
      (select count(*)::text from public.sale_payments where sale_id=$3) tender_count,
      (select coalesce(sum(amount),0)::text from public.sale_payments where sale_id=$3) tender_sum,
      (select quantity::text from public.inventory where warehouse_id=$4 and product_id=$5) stock_qty,
      (select coalesce(sum(l.debit-l.credit),0)::text from public.journal_entry_lines l
       join public.journal_entries j on j.id=l.journal_entry_id
       where j.reference_type='sale' and j.reference_id=$3) journal_delta
   `,[branch,invoice,saleId,warehouse,product]);
   expect(rows.rows[0]).toMatchObject({sale_count:'1',tender_count:'2'});
   expect(Number(rows.rows[0].tender_sum)).toBe(20);
   expect(Number(rows.rows[0].stock_qty)).toBe(4);
   expect(Number(rows.rows[0].journal_delta)).toBeCloseTo(0,5);
   // A balanced journal alone is not enough: verify cash 8 and bank 12
   // after the append-only adjustment to the original cash collection of 20.
   const allocation=await db.query<{cash_net:string,bank_net:string}>(`
     select
      coalesce(sum(l.debit-l.credit) filter (
       where l.account_id=public.resolve_account_key($1,'cash')),0)::text cash_net,
      coalesce(sum(l.debit-l.credit) filter (
       where l.account_id=public.resolve_account_key($1,'bank')),0)::text bank_net
     from public.journal_entry_lines l
     join public.journal_entries j on j.id=l.journal_entry_id
     where j.branch_id=$1
       and j.reference_type in ('sale','sale_split_tender_reclass')
       and j.reference_id=$2
   `,[branch,saleId]);
   expect(Number(allocation.rows[0].cash_net)).toBeCloseTo(8,5);
   expect(Number(allocation.rows[0].bank_net)).toBeCloseTo(12,5);

   const item=await db.query<{id:string}>(
    'select id from public.sale_items where sale_id=$1',[saleId]);
   expect(item.rows).toHaveLength(1);
   const refunded=await db.query<{result:{success?:boolean,error?:string,split_refund?:boolean}}>(
    "select public.process_refund($1,$2::jsonb,'CI split refund') result",
    [saleId,JSON.stringify([{sale_item_id:item.rows[0].id,quantity:1}])]);
   expect(refunded.rows[0].result?.success,JSON.stringify(refunded.rows[0].result)).toBe(true);
   expect(refunded.rows[0].result?.split_refund).toBe(true);
   const afterRefund=await db.query<{restored_qty:string,tender_refunded:string,reclass_count:string,journal_delta:string}>(`
     select
      (select quantity::text from public.inventory where warehouse_id=$1 and product_id=$2) restored_qty,
      (select coalesce(sum(refunded_amount),0)::text from public.sale_payments where sale_id=$3) tender_refunded,
      (select count(*)::text from public.journal_entries j where j.reference_type='refund_split_tender_reclass'
       and j.branch_id=$4) reclass_count,
      (select coalesce(sum(l.debit-l.credit),0)::text from public.journal_entry_lines l
       join public.journal_entries j on j.id=l.journal_entry_id
       where j.branch_id=$4 and j.reference_type in
       ('sale','refund','sale_split_tender_reclass','refund_split_tender_reclass')) journal_delta
   `,[warehouse,product,saleId,branch]);
   expect(Number(afterRefund.rows[0].restored_qty)).toBe(5);
   expect(Number(afterRefund.rows[0].tender_refunded)).toBe(20);
   expect(Number(afterRefund.rows[0].reclass_count)).toBe(1);
   expect(Number(afterRefund.rows[0].journal_delta)).toBeCloseTo(0,5);
  }finally{await db.query('ROLLBACK');}
 });
});
