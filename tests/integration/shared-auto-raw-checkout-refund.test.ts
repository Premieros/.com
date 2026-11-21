import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url=process.env.SUPABASE_DB_URL;
const local=(()=>{
  if(!url) return false;
  try { return ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname); }
  catch { return false; }
})();

(local ? describe : describe.skip)('Direct POS sale and refund on automatic raw debt (disposable DB only)',()=>{
  const db=new Client({connectionString:url});
  beforeAll(async()=>{await db.connect();});
  afterAll(async()=>{await db.end();});

  it.each(['cash','card'])('keeps automatic raw inventory exact through %s sale retries and partial refunds',async(paymentMethod)=>{
    const tag=randomUUID().replace(/-/g,'').slice(0,12);
    const org=randomUUID(),branch=randomUUID(),wh=randomUUID(),user=randomUUID(),product=randomUUID();
    const email=`ci-auto-sale-${tag}@ci.invalid`;
    await db.query('BEGIN');
    try {
      await db.query(`insert into public.roles(role,name_ar,name_en,permissions,scope,is_active)
          values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true)
          on conflict(role) do nothing`);
      await db.query('insert into public.organizations(id,name,slug) values($1,$2,$3)',
        [org,'CI Automatic Raw Checkout',`ci-auto-sale-${tag}`]);
      await db.query("insert into public.branches(id,name,organization_id,is_active) values($1,'CI Automatic Raw Branch',$2,true)",
        [branch,org]);
      await db.query('insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())',[user,email]);
      await db.query("select set_config('app.register_branch','on',true)");
      await db.query(`insert into public.users(id,email,full_name,role,branch_id,is_active)
          values($1,$2,'CI Test Admin','super_admin',$3,true)`,[user,email,branch]);
      await db.query("select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true),set_config('app.register_branch','off',true)",
        [user,JSON.stringify({sub:user,role:'authenticated'})]);
      await db.query("insert into public.warehouses(id,name,branch_id,is_active,is_default) values($1,'CI WH',$2,true,true)",
        [wh,branch]);
      await db.query(`insert into public.branch_settings(branch_id,tax_enabled,tax_rate,allow_negative_stock)
          values($1,false,0,false)`,[branch]);
      await db.query(`insert into public.products(id,name,sku,sale_price,cost_price,branch_id,is_active,product_type)
          values($1,'No-Recipe CI Item',$2,20,0,$3,true,'ready')`,
        [product,`CI-AUTO-${tag}`,branch]);
      const {rows:[policy]}=await db.query<{allow:boolean}>(
        'select public.effective_allow_negative_stock($1::uuid) allow',[branch]);
      expect(policy.allow).toBe(false);
      const invoice=`CI-AUTO-INVOICE-${tag}`;
      const items=JSON.stringify([{product_id:product,quantity:2,unit_price:20}]);
      const operationKey=`ci-auto-sale-${tag}`;
      const saleSql=`select public.process_sale_idempotent(
          $21::text,
          $1::text,$2::uuid,$3::uuid,$4::uuid,$5::uuid,
          $6::numeric,$7::numeric,$8::text,$9::numeric,$10::numeric,
          $11::numeric,$12::numeric,$13::text,$14::text,$15::jsonb,
          $16::uuid,$17::text,$18::uuid,$19::uuid,$20::integer
        ) data`;
      const saleArgs=[invoice,branch,wh,null,user,40,0,'amount',0,0,40,40,paymentMethod,'completed',
        items,null,'takeaway',null,null,null,operationKey];
      const invalidWarehouse=[...saleArgs];
      invalidWarehouse[2]=randomUUID();
      const {rows:[invalid]}=await db.query(saleSql,invalidWarehouse);
      expect(invalid.data.success).toBe(false);
      const {rows:[unmapped]}=await db.query(
        'select count(*)::text n from public.recipes where product_id=$1',[product]);
      expect(Number(unmapped.n)).toBe(0);
      const {rows:[checkout]}=await db.query<{data:{success:boolean;error?:string;sale_id?:string}}>(saleSql,saleArgs);
      expect(checkout.data).toMatchObject({success:true});
      expect(checkout.data.sale_id).toBeTruthy();
      const saleId=checkout.data.sale_id;
      const {rows:[raw]}=await db.query<{id:string;name:string;quantity:string}>(`
          select rm.id,rm.name,coalesce(sum(b.quantity),0)::text quantity
          from public.raw_materials rm
          left join public.raw_material_batches b on b.raw_material_id=rm.id and b.branch_id=$2
          where rm.code=$1 and rm.branch_id=$2
          group by rm.id,rm.name`,
        ['AUTO-PROD-'+product.replace(/-/g,''),branch]);
      expect(raw).toBeDefined();
      expect(raw.name).toBe('No-Recipe CI Item');
      expect(Number(raw.quantity)).toBe(-2);
      // A lost checkout response can allocate another display invoice. The
      // durable operation key must return the original sale without movement.
      const {rows:[replayed]}=await db.query(saleSql,[`CI-RETRY-${tag}`,...saleArgs.slice(1)]);
      expect(replayed.data).toMatchObject({success:true,sale_id:saleId,idempotent_replay:true});
      const changedArgs=[...saleArgs];
      changedArgs[14]=JSON.stringify([{product_id:product,quantity:3,unit_price:20}]);
      const {rows:[conflict]}=await db.query(saleSql,changedArgs);
      expect(conflict.data).toMatchObject({success:false,error:'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'});
      const rawBalance=async()=>{
        const {rows:[row]}=await db.query<{balance:string}>(`
          select coalesce(sum(quantity),0)::text balance from public.raw_material_batches
          where raw_material_id=$1 and branch_id=$2`,[raw.id,branch]);
        return Number(row.balance);
      };
      expect(await rawBalance()).toBe(-2);
      const {rows:itemsSold}=await db.query<{id:string;quantity:string}>(
        'select id,quantity::text quantity from public.sale_items where sale_id=$1 and product_id=$2',
        [saleId,product]);
      expect(itemsSold).toHaveLength(1);
      expect(Number(itemsSold[0].quantity)).toBe(2);
      const {rows:[returned]}=await db.query<{data:{success:boolean;error?:string}}>(
        'select public.process_refund($1::uuid,$2::jsonb,$3::text) data',
        [saleId,JSON.stringify([{sale_item_id:itemsSold[0].id,quantity:0.5}]),'CI partial refund']);
      expect(returned.data).toMatchObject({success:true});
      expect(await rawBalance()).toBe(-1.5);
      const {rows:[remainder]}=await db.query(
        'select public.process_refund($1::uuid,$2::jsonb,$3::text) data',
        [saleId,JSON.stringify([{sale_item_id:itemsSold[0].id,quantity:1.5}]),'CI remaining refund']);
      expect(remainder.data).toMatchObject({success:true});
      expect(await rawBalance()).toBe(0);
      const {rows:[excess]}=await db.query(
        'select public.process_refund($1::uuid,$2::jsonb,$3::text) data',
        [saleId,JSON.stringify([{sale_item_id:itemsSold[0].id,quantity:0.5}]),'CI over-refund rejected']);
      expect(excess.data).toMatchObject({success:false});
      expect(await rawBalance()).toBe(0);
      const {rows:[counters]}=await db.query(
        'select refunded_quantity::numeric quantity,refunded_amount::numeric amount from public.sale_items where id=$1',
        [itemsSold[0].id]);
      expect(Number(counters.quantity)).toBe(2);
      expect(Number(counters.amount)).toBe(40);
      // Do not accept a vacuously balanced empty journal: sale and refunds
      // must actually post, and every posted journal must balance separately.
      const {rows:journals}=await db.query<{id:string;lines:string;delta:string}>(`
        select j.id,count(l.id)::text lines,coalesce(sum(l.debit-l.credit),0)::text delta
        from public.journal_entries j
        left join public.journal_entry_lines l on l.journal_entry_id=j.id
        where j.branch_id=$1 and j.posting_status='POSTED'
        group by j.id`,[branch]);
      expect(journals.length).toBeGreaterThanOrEqual(3);
      for(const journal of journals){
        expect(Number(journal.lines)).toBeGreaterThanOrEqual(2);
        expect(Number(journal.delta)).toBeCloseTo(0,5);
      }
      const {rows:[saleCount]}=await db.query<{n:string}>(
        'select count(*)::text n from public.sales where invoice_number=$1',[invoice]);
      expect(Number(saleCount.n)).toBe(1);
    } finally {
      await db.query('ROLLBACK');
    }
  });
});

