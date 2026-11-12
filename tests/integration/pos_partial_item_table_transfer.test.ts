import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { PosItemTransferResult } from '@/features/pos/types';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error('SUPABASE_DB_URL is required for partial transfer integration tests');

type RlsIds = { branchA: string; whA: string; users: { cashier: string; branch_manager: string } };
async function seedRlsFixture(client: pg.Client): Promise<RlsIds> {
 const org = randomUUID(), branchA = randomUUID(), whA = randomUUID();
 const users = { cashier: randomUUID(), branch_manager: randomUUID() };
 await client.query("INSERT INTO public.organizations(id,name,slug) VALUES($1,'CI Partial Transfer',$2)", [org, `ci-partial-${org}`]);
 await client.query("INSERT INTO public.branches(id,name,organization_id,is_active) VALUES($1,'CI Partial Branch',$2,true)", [branchA, org]);
 await client.query("SELECT set_config('app.register_branch','on',true)");
 for (const [role, id] of Object.entries(users)) {
  const email = `ci-partial-${id}@ci.invalid`;
  await client.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id,email]);
  await client.query('INSERT INTO public.users(id,email,full_name,role,branch_id,is_active) VALUES($1,$2,$3,$3,$4,true)', [id,email,role,branchA]);
 }
 await client.query("SELECT set_config('app.register_branch','off',true)");
 await client.query("INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'CI Partial Warehouse',$2,true,true)", [whA,branchA]);
 return { branchA,whA,users };
}
async function runAsPersist(client: pg.Client, user: string, sql: string, values: unknown[]) {
 await client.query('SAVEPOINT partial_request');
 try {
  await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.jwt',$2,true)", [user,JSON.stringify({sub:user,role:'authenticated'})]);
  await client.query('SET LOCAL ROLE authenticated');
  const result = await client.query(sql,values);
  await client.query('RESET ROLE');
  await client.query("SELECT set_config('app.user_id','',true),set_config('app.jwt','{}',true)");
  await client.query('RELEASE SAVEPOINT partial_request');
  return { rows: result.rows, error: undefined as Error | undefined };
 } catch (error) {
  await client.query('ROLLBACK TO SAVEPOINT partial_request');
  await client.query('RELEASE SAVEPOINT partial_request');
  return { rows: [] as pg.QueryResultRow[], error: error as Error };
 }
}
// This proof is intentionally restricted to an owned disposable PostgreSQL.
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dbUrl).hostname)) throw new Error('PARTIAL_TRANSFER_TEST_REQUIRES_OWNED_LOCAL_DATABASE');
describe('partial table transfer against the full schema and actual guards', () => {
 let client: pg.Client, ids: RlsIds;
 let productId: string;
 let source: string, target: string, targetTable: string, line: string, originalEvent: string;
 let expected: Record<string, unknown>;
 const command = (quantity=1) => ({operation_id:randomUUID(),quantities:[{order_item_id:line,quantity,expected}]});
 async function transfer(payload=command(), actor=ids.users.cashier, destination=targetTable) {
  const result=await runAsPersist(client,actor,'SELECT public.transfer_order_items_to_table($1,ARRAY[$2::uuid],$3,$4::jsonb) result',[source,line,destination,JSON.stringify(payload)]);
  expect(result.error?.message).toBeUndefined();
  return result.rows[0].result as PosItemTransferResult & { error?: string; detail?: string };
 }
 beforeEach(async () => {
  client = new pg.Client({connectionString:dbUrl}); await client.connect();
  expect((await client.query('SELECT auth.is_ci_stub() ok')).rows[0].ok).toBe(true);
  await client.query('BEGIN');
  ids = await seedRlsFixture(client);
  await client.query(`UPDATE public.roles SET permissions=(COALESCE(permissions,'[]'::jsonb)||'["pos.order.transfer"]'::jsonb)-'users.manage' WHERE role='cashier'`);
  const product = (await client.query(`INSERT INTO public.products(name,sale_price,cost_price,branch_id,product_type) VALUES('Partial water',20,3,$1,'ready') RETURNING id`, [ids.branchA])).rows[0].id;
  productId = product;
  const tables = (await client.query(`INSERT INTO public.dining_tables(branch_id,name,status) VALUES($1,$2,'occupied'),($1,$3,'occupied') RETURNING id`, [ids.branchA, `partial-source-${randomUUID()}`, `partial-target-${randomUUID()}`])).rows;
  targetTable = tables[1].id;
  const orders = (await client.query(`INSERT INTO public.orders(order_number,branch_id,order_type,status,table_id,cashier_id,subtotal,discount_amount,discount_type,tax_amount,total) VALUES($1,$3,'dine_in','open',$4,$6,60,6,'amount',0,54),($2,$3,'dine_in','open',$5,$6,20,0,'amount',0,20) RETURNING id`, [`PARTIAL-${randomUUID()}`, `PARTIAL-${randomUUID()}`, ids.branchA, tables[0].id, tables[1].id, ids.users.branch_manager])).rows;
  source = orders[0].id; target = orders[1].id;
  const lines = (await client.query(`INSERT INTO public.order_items(order_id,product_id,quantity,unit_price,total,notes) VALUES($1,$3,3,20,60,'water'),($2,$3,1,20,20,'water') RETURNING id,order_id`, [source,target,product])).rows;
  line = lines.find(r => r.order_id === source).id;
  for (const row of lines) {
   const qty = row.order_id === source ? 3 : 1;
   const send = (await client.query(`INSERT INTO public.order_kitchen_sends(branch_id,order_id,order_item_id,sent_quantity,sent_by) VALUES($1,$2,$3,$4,$5) RETURNING id`,[ids.branchA,row.order_id,row.id,qty,ids.users.branch_manager])).rows[0].id;
   const event = (await client.query(`INSERT INTO public.order_kitchen_inventory_events(branch_id,warehouse_id,order_id,order_item_id,kitchen_send_id,sent_quantity,total_cost,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[ids.branchA,ids.whA,row.order_id,row.id,send,qty,qty*3,ids.users.branch_manager])).rows[0].id;
   if(row.order_id === source) {
    originalEvent=event;
    // Supply a frozen send-time snapshot without asking today's price trigger
    // to recreate historical data. This UPDATE is test-fixture setup only.
    await client.query(`UPDATE public.order_kitchen_inventory_events SET snapshot_version=2,component_snapshot=$2::jsonb WHERE id=$1`, [event,JSON.stringify([{ raw_material_id: randomUUID(), quantity: 0.999999, unit_cost: 9, extended_cost: 9, price_source: 'purchase', priced_at: '2026-01-01T00:00:00Z' }])]);
   }
  }
  expected = (await client.query(`SELECT jsonb_build_object('quantity',quantity,'product_id',product_id,'unit_name',unit_name,'unit_price',unit_price,'discount_amount',discount_amount,'bonus_quantity',bonus_quantity,'notes',COALESCE(notes,''),'modifier_option_ids',COALESCE(to_jsonb(modifier_option_ids),'[]')) expected FROM public.order_items WHERE id=$1`,[line])).rows[0].expected;
 });
 afterEach(async () => { if(client){ await client.query('ROLLBACK').catch(()=>{}); await client.end(); } });
 it('splits sent 3 into exact 2+1, retains original prices and financial quantities, retries once and sends nothing new', async () => {
  await client.query('UPDATE public.products SET sale_price=99 WHERE id=$1',[productId]);
  const ledgerBefore = (await client.query(`SELECT count(*)::int n FROM public.inventory_ledger`)).rows[0].n;
  const payload = { operation_id: randomUUID(), quantities: [{order_item_id:line,quantity:1,expected}] };
  const transfer = async (p=payload) => runAsPersist(client,ids.users.cashier,`SELECT public.transfer_order_items_to_table($1,ARRAY[$2::uuid],$3,$4::jsonb) result`,[source,line,targetTable,JSON.stringify(p)]);
  const moved = await transfer(); expect(moved.error).toBeUndefined(); const result=moved.rows[0].result as PosItemTransferResult;
  expect(result,JSON.stringify(result)).toMatchObject({success:true,source_order_empty:false,inventory_changed:false,kds_resent:false});
  const newLine=result.quantity_transfers![0].moved_item_id; expect(newLine).not.toBe(line);
  expect((await client.query(`SELECT quantity::float8 q FROM public.order_items WHERE id=$1`,[line])).rows[0].q).toBe(2);
  expect((await client.query('SELECT unit_price::float8 price FROM public.order_items WHERE id=$1',[newLine])).rows[0].price).toBe(20);
  const targets=(await client.query(`SELECT id,quantity::float8 q FROM public.order_items WHERE order_id=$1`,[target])).rows;
  expect(targets).toHaveLength(2); expect(targets.find(r=>r.id===newLine)?.q).toBe(1);
  // A partial move must repartition the existing KDS send, never enqueue a duplicate.
  const sendRows = (await client.query(`SELECT order_item_id,sent_quantity::float8 sent FROM public.order_kitchen_sends WHERE order_item_id=ANY($1::uuid[])`,[[line,newLine]])).rows;
  expect(sendRows).toHaveLength(2);
  expect(sendRows.find(r=>r.order_item_id===line)?.sent).toBe(2);
  expect(sendRows.find(r=>r.order_item_id===newLine)?.sent).toBe(1);
  expect(sendRows.reduce((sum,r)=>sum+r.sent,0)).toBe(3);
  const events=(await client.query(`SELECT * FROM public.order_kitchen_inventory_events WHERE order_item_id=ANY($1::uuid[])`,[[line,newLine]])).rows;
  expect(events).toHaveLength(2); expect(events.find(e=>e.order_item_id===newLine).transfer_origin_event_id).toBe(originalEvent);
  expect(events.reduce((n,e)=>n+Number(e.total_cost),0)).toBe(9);
  expect(Number(events.reduce((n,e)=>n+Number(e.component_snapshot[0].quantity),0).toFixed(6))).toBe(0.999999);
  expect(events.every(e=>e.component_snapshot[0].price_source==='purchase' && e.component_snapshot[0].unit_cost===9)).toBe(true);
  expect((await client.query(`SELECT sum(subtotal)::float8 subtotal,sum(discount_amount)::float8 discount FROM public.orders WHERE id=ANY($1::uuid[])`,[[source,target]])).rows[0]).toMatchObject({subtotal:80,discount:6});
  expect((await transfer()).rows[0].result).toMatchObject({success:true,replayed:true});
  expect(((await transfer({...payload,quantities:[{...payload.quantities[0],quantity:2}]})).rows[0].result as PosItemTransferResult).error).toBe('TRANSFER_OPERATION_CONFLICT');
  expect(((await transfer({...payload,operation_id:randomUUID()})).rows[0].result as PosItemTransferResult).error).toBe('TRANSFER_SOURCE_CHANGED');
  const beforeSend=(await client.query(`SELECT count(*)::int n FROM public.order_kitchen_inventory_events`)).rows[0].n;
  const send=await runAsPersist(client,ids.users.cashier,`SELECT public.send_to_kitchen($1,NULL::uuid) result`,[target]);
  expect(send.error).toBeUndefined();expect(send.rows[0].result,JSON.stringify(send.rows[0].result)).toMatchObject({success:true,all_sent:true});
  expect((await client.query(`SELECT count(*)::int n FROM public.order_kitchen_inventory_events`)).rows[0].n).toBe(beforeSend);
  expect((await client.query(`SELECT count(*)::int n FROM public.inventory_ledger`)).rows[0].n).toBe(ledgerBefore);
  expect((await client.query(`SELECT count(*)::int n FROM public.audit_log WHERE id=$1`,[payload.operation_id])).rows[0].n).toBe(1);
 });
 it('preserves served quantity and never makes a served transfer pending again', async () => {
  await client.query('INSERT INTO public.order_kitchen_served_quantities(order_id,order_item_id,served_quantity,served_at) VALUES($1,$2,3,now())',[source,line]);
  await client.query("UPDATE public.orders SET kitchen_status='served' WHERE id=$1",[source]);
  const result=await transfer();
  expect(result,JSON.stringify(result)).toMatchObject({success:true});
  const moved=result.quantity_transfers![0].moved_item_id;
  const served=(await client.query('SELECT order_id,order_item_id,served_quantity::float8 q FROM public.order_kitchen_served_quantities WHERE order_item_id=ANY($1::uuid[])',[[line,moved]])).rows;
  expect(served).toEqual(expect.arrayContaining([{order_id:source,order_item_id:line,q:2},{order_id:target,order_item_id:moved,q:1}]));
  expect((await client.query('SELECT kitchen_status FROM public.orders WHERE id=$1',[source])).rows[0].kitchen_status).toBe('served');
 });
 it('moves unsent quantity without creating kitchen, inventory or served records', async () => {
  await client.query('DELETE FROM public.order_kitchen_inventory_events WHERE order_item_id=$1',[line]);
  await client.query('DELETE FROM public.order_kitchen_sends WHERE order_item_id=$1',[line]);
  const result=await transfer();
  expect(result,JSON.stringify(result)).toMatchObject({success:true,inventory_changed:false,kds_resent:false});
  const moved=result.quantity_transfers![0].moved_item_id;
  for(const table of ['order_kitchen_sends','order_kitchen_inventory_events','order_kitchen_served_quantities']) {
   expect((await client.query(`SELECT count(*)::int n FROM public.${table} WHERE order_item_id=ANY($1::uuid[])`,[[line,moved]])).rows[0].n).toBe(0);
  }
 });
 it('rejects absent permission and forged session context without modifying the saved line', async () => {
  await client.query("UPDATE public.roles SET permissions=permissions-'pos.order.transfer' WHERE role='cashier'");
  expect(await transfer()).toMatchObject({success:false,error:'PERMISSION_DENIED'});
  await client.query("UPDATE public.roles SET permissions=(permissions||'[\"pos.order.transfer\"]'::jsonb)-'pos.order.edit' WHERE role='cashier'");
  const forged={actor_id:ids.users.cashier,source_order_id:source,target_order_id:target,source_item_id:line,new_item_id:randomUUID(),source_quantity:3,quantity:1,discount:0,bonus:0,total:20,sent_quantity:1};
  await client.query("SELECT set_config('app.pos_item_quantity_transfer_state',$1,true)",[JSON.stringify(forged)]);
  const attack=await runAsPersist(client,ids.users.cashier,'UPDATE public.order_items SET quantity=2,total=40 WHERE id=$1 RETURNING id',[line]);
  // RLS may reject by returning zero rows before any trigger executes.
  expect(attack.rows).toHaveLength(0);
  const privateWrite=await runAsPersist(client,ids.users.cashier,'INSERT INTO private.pos_partial_transfer_context VALUES(pg_backend_pid(),txid_current(),$1::jsonb)',[JSON.stringify(forged)]);
  expect(privateWrite.error).toBeDefined();
  expect((await client.query('SELECT quantity::float8 q FROM public.order_items WHERE id=$1',[line])).rows[0].q).toBe(3);
 });
 it('rejects foreign-branch actors and paid source or target atomically', async () => {
  const foreign=await seedRlsFixture(client);
  expect(await transfer(command(),foreign.users.cashier)).toMatchObject({success:false,error:'ORDER_NOT_FOUND'});
  for(const id of [source,target]) {
   await client.query("UPDATE public.orders SET payment_status='partial' WHERE id=$1",[id]);
   expect(await transfer()).toMatchObject({success:false,error:'TRANSFER_PAID_ORDER_REQUIRES_SETTLEMENT'});
   await client.query("UPDATE public.orders SET payment_status='unpaid' WHERE id=$1",[id]);
  }
  expect((await client.query('SELECT quantity::float8 q FROM public.order_items WHERE id=$1',[line])).rows[0].q).toBe(3);
 });
 it('validates all quantities before changing any line and leaves no audit on rejected requests', async () => {
  for(const quantity of [0,-1,4,0.00001]) {
   const payload=command(quantity);
   expect((await transfer(payload)).success).toBe(false);
   expect((await client.query('SELECT count(*)::int n FROM public.audit_log WHERE id=$1',[payload.operation_id])).rows[0].n).toBe(0);
  }
  const changed=command(); changed.quantities[0].expected={...expected,unit_price:99};
  expect(await transfer(changed)).toMatchObject({success:false,error:'TRANSFER_SOURCE_CHANGED'});
  expect((await client.query('SELECT quantity::float8 q FROM public.order_items WHERE id=$1',[line])).rows[0].q).toBe(3);
 });
 it('keeps old three-argument whole-row clients compatible with the November composite FK', async () => {
  const result=await runAsPersist(client,ids.users.cashier,'SELECT public.transfer_order_items_to_table($1,ARRAY[$2::uuid],$3) result',[source,line,targetTable]);
  expect(result.error?.message).toBeUndefined();
  expect(result.rows[0].result,JSON.stringify(result.rows[0].result)).toMatchObject({success:true,source_order_empty:true});
  expect((await client.query('SELECT order_id,quantity::float8 q FROM public.order_items WHERE id=$1',[line])).rows[0]).toEqual({order_id:target,q:3});
  expect((await client.query('SELECT order_id FROM public.order_kitchen_sends WHERE order_item_id=$1',[line])).rows[0].order_id).toBe(target);
 });
 it('sends real stock, transfers, prints once and settles both orders without consuming stock twice', async () => {
  await client.query('INSERT INTO public.branch_settings(branch_id,tax_enabled,tax_rate) VALUES($1,true,15) ON CONFLICT(branch_id) DO UPDATE SET tax_enabled=true,tax_rate=15',[ids.branchA]);
  await client.query("UPDATE public.roles SET permissions=permissions||'[\"pos.send_kitchen\",\"pos.payment.take\",\"pos.discount\",\"pos.receipt.print\"]'::jsonb WHERE role='cashier'");
  await client.query('DELETE FROM public.order_kitchen_inventory_events WHERE order_id=ANY($1::uuid[])',[[source,target]]);
  await client.query('DELETE FROM public.order_kitchen_sends WHERE order_id=ANY($1::uuid[])',[[source,target]]);
  await client.query('SELECT public.seed_account_mappings($1)',[ids.branchA]);
  const unit=randomUUID(),raw=randomUUID();
  await client.query("INSERT INTO public.measurement_units(id,code,name,symbol,is_active) VALUES($1,$2,'CI transfer unit','u',true)",[unit,`PT-${unit}`]);
  await client.query("INSERT INTO public.raw_materials(id,code,name,unit_id,default_cost,is_active,branch_id) VALUES($1,$2,'CI transfer raw',$3,3,true,$4)",[raw,`PT-${raw}`,unit,ids.branchA]);
  const recipe=(await client.query("INSERT INTO public.recipes(product_id,branch_id,name,yield_quantity,is_active) VALUES($1,$2,'CI transfer recipe',1,true) RETURNING id",[productId,ids.branchA])).rows[0].id;
  await client.query('INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent) VALUES($1,$2,1,0)',[recipe,raw]);
  await client.query("SELECT public._raw_add($1,$2,$3,10,3,'CI-transfer',CURRENT_DATE,NULL,'purchase','purchase',$4,'CI-transfer',$5)",[raw,ids.branchA,ids.whA,randomUUID(),ids.users.cashier]);
  for(const order of [source,target]) {
   const sent=await runAsPersist(client,ids.users.cashier,'SELECT public.send_to_kitchen($1,NULL::uuid) result',[order]);
   expect(sent.error?.message).toBeUndefined();
   expect(sent.rows[0].result,JSON.stringify(sent.rows[0].result)).toMatchObject({success:true});
  }
  const stock=async()=> Number((await client.query('SELECT COALESCE(sum(quantity),0)::float8 q FROM public.raw_material_batches WHERE raw_material_id=$1 AND warehouse_id=$2',[raw,ids.whA])).rows[0].q);
  expect(await stock()).toBe(6);
  const before=(await client.query('SELECT count(*)::int n FROM public.inventory_ledger WHERE branch_id=$1',[ids.branchA])).rows[0].n;
  const moved=await transfer(); expect(moved,JSON.stringify(moved)).toMatchObject({success:true});
  expect(await stock()).toBe(6);
  const printKey=`partial-print-${randomUUID()}`;
  const print=()=>runAsPersist(client,ids.users.cashier,'SELECT public.enqueue_cloud_open_order_print($1,$2::jsonb,$3) result',[target,JSON.stringify({text:'OPEN CHECK\nWater 2 x 20\nDiscount 2\nTax 5.70\nTotal 43.70',items:[{product_id:productId,quantity:2}]}),printKey]);
  const printed=await print(); expect(printed.error?.message).toBeUndefined(); expect(printed.rows[0].result,JSON.stringify(printed.rows[0].result)).toMatchObject({success:true,station_code:'cashier'});
  const retry=await print(); expect(retry.rows[0].result.job_id).toBe(printed.rows[0].result.job_id);
  expect((await client.query('SELECT count(*)::int n FROM public.cloud_print_jobs WHERE idempotency_key=$1',[printKey])).rows[0].n).toBe(1);
  const shift=randomUUID();
  await client.query("INSERT INTO public.shifts(id,branch_id,cashier_id,status,opening_amount) VALUES($1,$2,$3,'open',0)",[shift,ids.branchA,ids.users.cashier]);
  const sales:string[]=[];
  for(const order of [source,target]) {
   const preview=await runAsPersist(client,ids.users.cashier,'SELECT public.get_order_settlement_preview($1) result',[order]);
   expect(preview.error?.message).toBeUndefined(); const p=preview.rows[0].result;
   expect(p,JSON.stringify(p)).toMatchObject({success:true});
   const sale=await runAsPersist(client,ids.users.cashier,`SELECT public.process_sale($1,$2,$3,NULL,NULL,$4,$5,'amount',$6,0,$7,$7,'cash','completed',$8::jsonb,$9,'dine_in',$10,$11,1) result`,[`PARTIAL-SALE-${randomUUID()}`,ids.branchA,ids.whA,p.subtotal,p.discount_amount,p.tax_amount,p.total,JSON.stringify(p.items),shift,p.table_id??(order===target?targetTable:(await client.query('SELECT table_id FROM public.orders WHERE id=$1',[source])).rows[0].table_id),order]);
   expect(sale.error?.message).toBeUndefined(); expect(sale.rows[0].result,JSON.stringify(sale.rows[0].result)).toMatchObject({success:true});
   sales.push(sale.rows[0].result.sale_id);
  }
  expect(await stock()).toBe(6);
  expect((await client.query('SELECT count(*)::int n FROM public.inventory_ledger WHERE branch_id=$1',[ids.branchA])).rows[0].n).toBe(before);
  const totals=(await client.query('SELECT sum(total)::float8 total,sum(paid_amount)::float8 paid FROM public.sales WHERE id=ANY($1::uuid[])',[sales])).rows[0];
  expect(totals).toEqual({total:85.1,paid:85.1});
  expect((await client.query('SELECT count(*)::int n FROM public.orders WHERE id=ANY($1::uuid[]) AND status=\'completed\'',[[source,target]])).rows[0].n).toBe(2);
 });
 it('rejects overlapping branch commands without blocking and succeeds after the competing transaction ends', async () => {
  const other=new pg.Client({connectionString:dbUrl}); await other.connect();
  try {
   await other.query('BEGIN');
   await other.query("SELECT pg_advisory_xact_lock(hashtextextended('pos-quantity-transfer:'||$1::text,0))",[ids.branchA]);
   const payload=command();
   expect(await transfer(payload)).toMatchObject({success:false,error:'TRANSFER_BUSY'});
   expect((await client.query('SELECT quantity::float8 q FROM public.order_items WHERE id=$1',[line])).rows[0].q).toBe(3);
   await other.query('ROLLBACK');
   expect(await transfer(payload)).toMatchObject({success:true});
   expect(await transfer(payload)).toMatchObject({success:true,replayed:true});
  } finally { await other.query('ROLLBACK'); await other.end(); }
 });
 it('preserves guard privileges, denies helper execution and validates the composite FK', async () => {
  const guards=['guard_pos_operator_ownership','guard_kitchen_send_operator_ownership','guard_sent_order_item_mutation','enforce_pos_permission_mutation','_reprice_order_item'];
  const metadata=(await client.query(`SELECT proname,prosecdef,pg_get_userbyid(proowner) owner,proconfig,has_function_privilege('authenticated',oid,'EXECUTE') allowed FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1)`,[guards])).rows;
  expect(metadata).toHaveLength(5);
  for(const row of metadata) expect(row).toMatchObject({prosecdef:true,owner:'postgres',proconfig:['search_path=public, pg_temp'],allowed:false});
  const helpers=(await client.query(`SELECT proname,prosecdef,has_function_privilege('authenticated',oid,'EXECUTE') allowed FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('_pos_split_transfer_line','_pos_partial_transfer_context','_pos_transfer_snapshot_part','_pos_transfer_pair_snapshot')`)).rows;
  expect(helpers).toHaveLength(4);
  expect(helpers.every(r=>!r.prosecdef&&!r.allowed)).toBe(true);
  const fk=(await client.query("SELECT convalidated,condeferrable,condeferred FROM pg_constraint WHERE conname='premier_kitchen_send_item_order_fk'")).rows[0];
  expect(fk).toEqual({convalidated:true,condeferrable:true,condeferred:false});
  expect(await transfer()).toMatchObject({success:true});
  expect((await client.query('SELECT count(*)::int n FROM private.pos_partial_transfer_context')).rows[0].n).toBe(0);
 });
 it('disables new partial transfers while preserving prior results, lineage and old clients', async () => {
  const payload=command(); const result=await transfer(payload);
  expect(result).toMatchObject({success:true});
  // Execute the reviewed disable script inside this test's rollback-only
  // transaction; leave the outer fixture transaction in control of cleanup.
  const disable=readFileSync('scripts/db/rollback/pos_partial_transfer_disable_REVIEW_ONLY.sql','utf8');
  await client.query(disable.replace(/^(?:BEGIN|COMMIT);\r?$/gm,''));
  expect(await transfer(payload)).toMatchObject({success:true,replayed:true});
  expect(await transfer()).toMatchObject({success:false,error:'PARTIAL_TRANSFER_DISABLED'});
  const legacy=await runAsPersist(client,ids.users.cashier,'SELECT public.transfer_order_items_to_table($1,ARRAY[$2::uuid],$3) result',[source,line,targetTable]);
  expect(legacy.error?.message).toBeUndefined(); expect(legacy.rows[0].result).toMatchObject({success:true});
  expect((await client.query('SELECT sum(quantity)::float8 q FROM public.order_items WHERE order_id=$1',[target])).rows[0].q).toBe(4);
  expect((await client.query('SELECT count(*)::int n FROM public.order_kitchen_inventory_events WHERE transfer_origin_event_id=$1',[originalEvent])).rows[0].n).toBe(1);
 });
});
