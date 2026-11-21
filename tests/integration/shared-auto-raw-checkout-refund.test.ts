import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url=process.env.SUPABASE_DB_URL;
const local=!!url && /(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//.test(url);

(local ? describe : describe.skip)('Direct POS sale and refund on automatic raw debt (disposable DB only)',()=>{
  const db=new Client({connectionString:url});
  beforeAll(async()=>{await db.connect();});
  afterAll(async()=>{await db.end();});

  it('sells a zero-cost unmapped product on strict-stock branch then refunds its negative raw once',async()=>{
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
      const {rows:[checkout]}=await db.query<{data:{success:boolean;error?:string;sale_id?:string}}>(
        `select public.process_sale(
          $1::text,$2::uuid,$3::uuid,$4::uuid,$5::uuid,
          $6::numeric,$7::numeric,$8::text,$9::numeric,$10::numeric,
          $11::numeric,$12::numeric,$13::text,$14::text,$15::jsonb,
          $16::uuid,$17::text,$18::uuid,$19::uuid,$20::integer
        ) data`,
        [invoice,branch,wh,null,user,40,0,'amount',0,0,40,40,'cash','completed',
          items,null,'takeaway',null,null,null]);
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
      const {rows:itemsSold}=await db.query<{id:string;quantity:string}>(
        'select id,quantity::text quantity from public.sale_items where sale_id=$1 and product_id=$2',
        [saleId,product]);
      expect(itemsSold).toHaveLength(1);
      expect(Number(itemsSold[0].quantity)).toBe(2);
      const {rows:[returned]}=await db.query<{data:{success:boolean;error?:string}}>(
        'select public.process_refund($1::uuid,$2::jsonb,$3::text) data',
        [saleId,JSON.stringify([{sale_item_id:itemsSold[0].id,quantity:2}]),'CI automated refund']);
      expect(returned.data).toMatchObject({success:true});
      const {rows:[after]}=await db.query<{balance:string}>(`
        select coalesce(sum(quantity),0)::text balance from public.raw_material_batches
        where raw_material_id=$1 and branch_id=$2`,[raw.id,branch]);
      expect(Number(after.balance)).toBe(0);
      const {rows:[saleCount]}=await db.query<{n:string}>(
        'select count(*)::text n from public.sales where invoice_number=$1',[invoice]);
      expect(Number(saleCount.n)).toBe(1);
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
