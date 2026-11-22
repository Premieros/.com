import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

// A disposable CI PostgreSQL transaction only, never the customer production DB.
const url=process.env.SUPABASE_DB_URL;
const isLocal=!!url&&/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//.test(url);
(isLocal ? describe : describe.skip)('Delivery fee settlement', () => {
 const db = new Client({ connectionString: url });
 beforeAll(async () => { await db.connect(); });
 afterAll(async () => { await db.end(); });
 it.each(['cash', 'split'])('collects and posts a tax-free fee once through %s', async (method) => {
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
   await db.query("insert into public.branch_settings(branch_id,tax_enabled,tax_rate,allow_negative_stock) values($1,true,14,false) on conflict(branch_id) do update set tax_enabled=true,tax_rate=14,allow_negative_stock=false,updated_at=now()",[branch]);
   await db.query("select public.seed_account_mappings($1)",[branch]);
   await db.query("insert into public.products(id,name,sku,cost_price,sale_price,wholesale_price,is_active,product_type,branch_id) values($1,'CI Split Product',$2,5,20,20,true,'ready',$3)",[product,`CISP-${tag}`,branch]);
   const purchase=await db.query<{result:{success:boolean,error?:string}}>(
     "select public.process_purchase($1,null,$2,$3,25,0,0,25,25,'cash','completed','CI split seed',jsonb_build_array(jsonb_build_object('product_id',$4::text,'quantity',5,'unit_cost',5,'unit_name','piece','batch_number',$5::text))) result",
     [`PUR-SPLIT-${tag}`,branch,warehouse,product,`B-${tag}`]);
   expect(purchase.rows[0].result?.success,JSON.stringify(purchase.rows[0].result)).toBe(true);
   const shift = randomUUID();
   await db.query(`insert into public.shifts(id,branch_id,cashier_id,status,opening_amount)
     values($1,$2,$3,'open',0)`, [shift, branch, user]);
   const table = (await db.query("insert into public.dining_tables(branch_id,name,status) values($1,'CI QR anchor','vacant') returning id", [branch])).rows[0].id;
   await db.query('select public.qr_configure($1,$2)', [branch, [product]]);
   await db.query("select public.qr_save_customer_settings($1,true,'{}'::jsonb,ARRAY[]::text[],true)", [branch]);
   const token = (await db.query('select public.qr_rotate($1,true) token', [table])).rows[0].token;
   const session = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
   await db.query("select public.qr_guest_begin($1,$2,'01012345678','CI Customer','delivery',null,null,'CI delivery address')", [token, session]);
   const requested = (await db.query('select public.qr_guest_place($1,$2,$3,$4::jsonb,null) result', [
     token, session, randomUUID(), JSON.stringify([{ product_id: product, price: 20, quantity: 1, notes: '' }]),
   ])).rows[0].result;
   const accepted = (await db.query('select public.qr_review($1,true,null) result', [requested.id])).rows[0].result;
   expect(accepted, JSON.stringify(accepted)).toMatchObject({ status: 'accepted' });
   const orderId = accepted.order_id;
   const track = async () => (await db.query('select public.qr_guest_track($1,$2) result', [token, session])).rows[0].result.bills[0];
   expect(await track()).toMatchObject({ bill_confirmed: false, delivery_fee_amount: null });
   expect((await db.query('select public.get_order_settlement_preview($1) result', [orderId])).rows[0].result)
     .toMatchObject({ success: false, error: 'DELIVERY_FEE_REQUIRED' });
   expect((await db.query('select public.save_order_delivery_fee($1,5) result', [orderId])).rows[0].result)
     .toMatchObject({ amount: 5, collected: false });
   expect(await track()).toMatchObject({ bill_confirmed: false, delivery_fee_amount: 5 });
   const sent = (await db.query('select public.send_to_kitchen($1,$2) result', [orderId, warehouse])).rows[0].result;
   expect(sent, JSON.stringify(sent)).toMatchObject({ success: true });
   const preview = (await db.query('select public.get_order_settlement_preview($1) result', [orderId])).rows[0].result;
   expect(preview, JSON.stringify(preview)).toMatchObject({ subtotal: 20, tax_amount: 2.8, delivery_fee_amount: 5, total: 27.8 });
   expect(await track()).toMatchObject({ bill_confirmed: true, delivery_fee_amount: 5, total: 27.8, tax_amount: 2.8 });
   await db.query('select public.save_order_delivery_fee($1,6)', [orderId]);
   expect(await track()).toMatchObject({ bill_confirmed: true, delivery_fee_amount: 6, total: 28.8 });
   await db.query('select public.save_order_delivery_fee($1,5)', [orderId]);
   const invoice = `FEE-${tag}`;
   const payment = method === 'split'
     ? JSON.stringify([{ payment_method: 'cash', amount: 10 }, { payment_method: 'card', amount: 17.8 }])
     : 27.8;
   const sql = method === 'split'
     ? `select public.process_sale_split($1,$2,$3,null,$4,20,0,'amount',2.8,0,27.8,$5::jsonb,'completed',$6::jsonb,$7,'delivery',null,$8,1) result`
     : `select public.process_sale($1,$2,$3,null,$4,20,0,'amount',2.8,0,27.8,$5::numeric,'cash','completed',$6::jsonb,$7,'delivery',null,$8,1) result`;
   const readShift = async () => (await db.query('select public.get_shift_closing_report($1) result', [shift])).rows[0].result;
   const openingCash = (await readShift()).expected_cash;
   const sale = (await db.query(sql, [invoice, branch, warehouse, user, payment, JSON.stringify(preview.items), shift, orderId])).rows[0].result;
   expect(sale, JSON.stringify(sale)).toMatchObject({ success: true });
   expect((await db.query(`select total::float8, tax_amount::float8, paid_amount::float8, delivery_fee_amount::float8
     from public.sales where id=$1`, [sale.sale_id])).rows[0]).toMatchObject({ total: 27.8, tax_amount: 2.8, paid_amount: 27.8, delivery_fee_amount: 5 });
   expect((await db.query('select public.order_delivery_fee($1) result', [orderId])).rows[0].result)
     .toMatchObject({ amount: 5, collected: true });
   expect(await track()).toMatchObject({ total: 27.8, paid_amount: 27.8, balance: 0 });
   const journal = await db.query(`select coalesce(sum(l.debit-l.credit),0)::float8 delta
     from public.journal_entry_lines l join public.journal_entries j on j.id=l.journal_entry_id
     where j.reference_id=$1`, [sale.sale_id]);
   expect(journal.rows[0].delta).toBe(0);
   const stock = async () => (await db.query(
     'select quantity::float8 qty from public.inventory where warehouse_id=$1 and product_id=$2',
     [warehouse, product],
   )).rows[0].qty;
   const paidShift = await readShift();
   expect(paidShift).toMatchObject({ success: true, invoice_count: 1, net_sales: 27.8, returns: 0 });
   expect(paidShift.expected_cash - openingCash).toBeCloseTo(method === 'split' ? 10 : 27.8, 2);
   // Recipe-less POS items consume the branch's product-linked fallback raw.
   const event = (await db.query('select component_snapshot from public.order_kitchen_inventory_events where order_id=$1', [orderId])).rows[0];
   expect(event.component_snapshot).toMatchObject([{ quantity: 1 }]);
   const rawStock = async () => (await db.query(
     'select coalesce(sum(quantity),0)::float8 qty from public.raw_material_inventory where branch_id=$1 and raw_material_id=$2',
     [branch, event.component_snapshot[0].raw_material_id],
   )).rows[0].qty;
   expect(await rawStock()).toBe(-1);
   expect(await stock()).toBe(5);
   const item = (await db.query('select id from public.sale_items where sale_id=$1', [sale.sale_id])).rows[0];
   const refund = (await db.query("select public.process_refund($1,$2::jsonb,'CI full refund') result",
     [sale.sale_id, JSON.stringify([{ sale_item_id: item.id, quantity: 1 }])])).rows[0].result;
   expect(refund, JSON.stringify(refund)).toMatchObject({ success: true, refunded_amount: 27.8 });
   const refundedShift = await readShift();
   expect(refundedShift).toMatchObject({ success: true, invoice_count: 1, net_sales: 0, returns: 27.8, expected_cash: openingCash });
   expect(await stock()).toBe(5);
   expect(await rawStock()).toBe(0);

  } finally {
   await db.query('ROLLBACK');
  }
 });
});
