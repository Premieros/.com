import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

// This suite can only initialize a disposable loopback database named qr_test.
const url = new URL(process.env.QR_TEST_DB_URL || 'postgres://postgres:postgres@127.0.0.1:5432/qr_test');
if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.pathname !== '/qr_test') throw new Error('QR concurrency tests require a disposable local qr_test database');
const a = new Client({ connectionString: url.href });
const b = new Client({ connectionString: url.href });
const admin = new Client({ connectionString: url.href });
const branch = '10000000-0000-4000-8000-000000000001';
const table = '30000000-0000-4000-8000-000000000001';
const product = '40000000-0000-4000-8000-000000000001';
const user = '20000000-0000-4000-8000-000000000001';
const items = JSON.stringify([{ product_id: product, quantity: 2, price: 25, notes: '' }]);
const key = '50000000-0000-4000-8000-000000000001';
let token;
const scalar = async (c, sql, args = []) => (await c.query(sql, args)).rows[0]?.result;
async function staff(c) { await c.query('RESET ROLE'); await c.query("select set_config('request.jwt.claim.sub',$1,false)",[user]); await c.query('SET ROLE authenticated'); }
async function guest(c) { await c.query("RESET ROLE; select set_config('request.jwt.claim.sub','',false); SET ROLE anon"); }
async function waiting(c) {
  const deadline = Date.now()+5000;
  while (Date.now()<deadline) {
    const locked = await scalar(admin,"select wait_event_type='Lock' result from pg_stat_activity where pid=$1",[c.processID]);
    if (locked) return;
    await new Promise(done => setTimeout(done,20));
  }
  throw new Error('Expected the concurrent operation to wait on a row lock');
}
before(async () => {
  await Promise.all([a.connect(),b.connect(),admin.connect()]);
  for (const path of ['tests/fixtures/qr-base.sql','tests/fixtures/qr-deployed-order-functions.sql','tests/fixtures/qr-deployed-triggers.sql','tests/fixtures/qr-deployed-sent-pricing.sql']) await admin.query(readFileSync(path,'utf8'));
  await admin.query(`CREATE TRIGGER pricing BEFORE INSERT OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public._reprice_order_item();
    CREATE TRIGGER sent_guard BEFORE UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.guard_sent_order_item_mutation();
    CREATE TRIGGER totals AFTER INSERT OR UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public._sync_order_totals_from_items();
    CREATE TRIGGER ownership BEFORE INSERT OR UPDATE OR DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_pos_operator_ownership();
    CREATE TRIGGER ownership BEFORE INSERT OR UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.guard_pos_operator_ownership();
    CREATE TRIGGER permission BEFORE INSERT OR UPDATE OR DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.enforce_pos_permission_mutation();
    CREATE TRIGGER permission BEFORE INSERT OR UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.enforce_pos_permission_mutation();`);
  await admin.query(readFileSync('supabase/migrations/20261114001719_premier_qr_table_ordering.sql','utf8'));
  await admin.query(`ALTER TABLE public.users ADD COLUMN role text DEFAULT 'cashier'; ALTER TABLE public.products ADD COLUMN image_url text, ADD COLUMN category_id uuid; CREATE TABLE public.categories(id uuid,name text,branch_id uuid); CREATE TABLE public.branch_settings(branch_id uuid,currency text); INSERT INTO public.dining_tables(id,branch_id,name) VALUES ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Table B');`);
  await admin.query(readFileSync('supabase/migrations/20261114013903_customer_experience_qr_table_ordering.sql','utf8'));
  await admin.query('CREATE TABLE public.sales(id uuid PRIMARY KEY,branch_id uuid,source_order_id uuid,paid_amount numeric,refunded_amount numeric)');
  await admin.query(readFileSync('supabase/migrations/20261114023132_guest_tracking_qr_table_ordering.sql','utf8'));
  await admin.query(readFileSync('supabase/migrations/20260909225500_pos_service_order_details.sql','utf8'));
  await admin.query(readFileSync('supabase/migrations/20261114093244_customer_checkin_qr_table_ordering.sql','utf8'));
});
beforeEach(async () => {
  await a.query('ROLLBACK'); await b.query('ROLLBACK');
  await admin.query('TRUNCATE qr_private.service_calls,qr_private.requests,qr_private.table_links,qr_private.menu_products,public.orders,public.order_items,public.order_kitchen_sends CASCADE');
  await staff(a); await staff(b);
  await a.query('select public.qr_configure($1,$2)',[branch,[product]]);
  await a.query('select public.qr_save_customer_settings($1,true,$2,$3,false)',[branch,{},[]]);
  token = await scalar(a,'select public.qr_rotate($1,true) result',[table]);
});

async function checkedDelivery() {
  await staff(a); await a.query('select public.qr_save_customer_settings($1,true,$2,$3,true)',[branch,{},[]]);
  await guest(a); await guest(b);
  await scalar(a,'select public.qr_guest_begin($1,$2,$3,$4,$5,null,null,$6) result',[token,'a'.repeat(64),'01012345678','Test Guest','delivery','Test delivery address']);
}
test('checked-in delivery submission and acceptance remain idempotent under concurrent retries',async()=>{
  await checkedDelivery();await a.query('BEGIN');
  const first=await scalar(a,'select public.qr_guest_place($1,$2,$3,$4,null) result',[token,'a'.repeat(64),key,items]);
  const retry=scalar(b,'select public.qr_guest_place($1,$2,$3,$4,null) result',[token,'a'.repeat(64),key,items]);
  await waiting(b);await a.query('COMMIT');assert.equal((await retry).id,first.id);
  await staff(a);await staff(b);await a.query('BEGIN');
  const accepted=await scalar(a,'select public.qr_review($1,true,null) result',[first.id]);
  const next=scalar(b,'select public.qr_review($1,true,null) result',[first.id]);
  await waiting(b);await a.query('COMMIT');assert.equal((await next).order_id,accepted.order_id);
  assert.equal(await scalar(admin,'select count(*)::int result from public.orders'),1);
});
test('concurrent wrong PIN attempts persist and stop at the three-attempt lock',async()=>{
  await checkedDelivery();const first=await scalar(a,'select public.qr_guest_place($1,$2,$3,$4,null) result',[token,'a'.repeat(64),key,items]);
  const wrong=first.recovery_code==='00'?'01':'00';await a.query('BEGIN');
  await scalar(a,'select public.qr_guest_resume($1,$2,$3,$4) result',[token,'b'.repeat(64),'01012345678',wrong]);
  const next=scalar(b,'select public.qr_guest_resume($1,$2,$3,$4) result',[token,'c'.repeat(64),'01012345678',wrong]);
  await waiting(b);await a.query('COMMIT');assert.equal((await next).error,'QR_PIN_INVALID');
  assert.equal((await scalar(b,'select public.qr_guest_resume($1,$2,$3,$4) result',[token,'c'.repeat(64),'01012345678',wrong])).error,'QR_PIN_LOCKED');
  assert.equal((await scalar(b,'select public.qr_guest_resume($1,$2,$3,$4) result',[token,'c'.repeat(64),'01012345678',first.recovery_code])).error,'QR_PIN_LOCKED');
});
after(async () => { await a.query('ROLLBACK'); await b.query('ROLLBACK'); await Promise.all([a.end(),b.end(),admin.end()]); });

test('simultaneous guest retries return one request', async () => {
  await guest(a); await guest(b); await a.query('BEGIN');
  const first = await scalar(a,'select public.qr_submit($1,$2,$3) result',[token,key,items]);
  const second = scalar(b,'select public.qr_submit($1,$2,$3) result',[token,key,items]);
  await waiting(b); await a.query('COMMIT');
  assert.deepEqual(await second,first);
  assert.equal(await scalar(admin,'select count(*)::int result from qr_private.requests'),1);
});
test('simultaneous acceptance is atomic and idempotent', async () => {
  await guest(a); const pending = await scalar(a,'select public.qr_submit($1,$2,$3) result',[token,key,items]);
  await staff(a); await a.query('BEGIN');
  const first = await scalar(a,'select public.qr_decide($1,true) result',[pending.id]);
  const second = scalar(b,'select public.qr_decide($1,true) result',[pending.id]);
  await waiting(b); await a.query('COMMIT');
  assert.deepEqual(await second,first);
  assert.equal(await scalar(admin,'select count(*)::int result from public.orders'),1);
  assert.equal(await scalar(admin,'select count(*)::int result from public.order_items'),1);
});
test('native POS creation and QR acceptance serialize on the same table', async () => {
  await guest(a); const pending = await scalar(a,'select public.qr_submit($1,$2,$3) result',[token,key,items]);
  await staff(a); await a.query('BEGIN');
  const created = await scalar(a,'select public.create_order(p_branch_id=>$1,p_table_id=>$2,p_items=>$3) result',[branch,table,items]);
  assert.equal(created.success,true);
  const accepted = scalar(b,'select public.qr_decide($1,true) result',[pending.id]);
  accepted.catch(() => {});
  await waiting(b); await a.query('COMMIT');
  await assert.rejects(accepted,/QR_TABLE_BUSY/);
  assert.equal(await scalar(admin,'select count(*)::int result from public.orders'),1);
  assert.equal(await scalar(admin,'select count(*)::int result from public.order_items'),1);
  assert.equal(await scalar(admin,'select quantity::int result from public.order_items'),2);
});

test('same key cannot choose two tables concurrently',async()=>{
  const other='30000000-0000-4000-8000-000000000002';
  await guest(a);await guest(b);await a.query('BEGIN');
  await scalar(a,'select public.qr_submit_selected($1,$2,$3,$4) result',[token,key,items,table]);
  const conflict=scalar(b,'select public.qr_submit_selected($1,$2,$3,$4) result',[token,key,items,other]);conflict.catch(()=>{});
  await waiting(b);await a.query('COMMIT');await assert.rejects(conflict,/QR_IDEMPOTENCY_CONFLICT/);
  assert.equal(await scalar(admin,'select count(*)::int result from qr_private.requests'),1);
});
test('two pending guests cannot claim the same alternative table',async()=>{
  const other='30000000-0000-4000-8000-000000000002';
  await guest(a);const first=await scalar(a,'select public.qr_submit($1,$2,$3) result',[token,key,items]);
  const next=await scalar(a,'select public.qr_submit($1,$2,$3) result',[token,'50000000-0000-4000-8000-000000000002',items]);
  await staff(a);await a.query('BEGIN');await scalar(a,'select public.qr_review($1,true,$2) result',[first.id,other]);
  const second=scalar(b,'select public.qr_review($1,true,$2) result',[next.id,other]);second.catch(()=>{});
  await waiting(b);await a.query('COMMIT');await assert.rejects(second,/QR_TABLE_BUSY/);
  assert.equal(await scalar(admin,'select count(*)::int result from public.orders'),1);
  assert.equal(await scalar(admin,"select status result from qr_private.requests where id=$1",[next.id]),'pending');
});

test('two simultaneous service calls for one visit create one pending notification',async()=>{
  const session='a'.repeat(64);await guest(a);await guest(b);await a.query('BEGIN');
  const first=await scalar(a,'select public.qr_call_service($1,$2,$3,$4,$5,$6) result',[token,session,key,table,'service','Help']);
  const second=scalar(b,'select public.qr_call_service($1,$2,$3,$4,$5,$6) result',[token,session,'50000000-0000-4000-8000-000000000002',table,'service','Help']);
  await waiting(b);await a.query('COMMIT');assert.equal((await second).id,first.id);assert.equal(await scalar(admin,'select count(*)::int result from qr_private.service_calls'),1);
});
test('a second device cannot adopt a simultaneous request key',async()=>{
  await guest(a);await guest(b);await a.query('BEGIN');
  await scalar(a,'select public.qr_place($1,$2,$3,$4,$5) result',[token,'a'.repeat(64),key,items,table]);
  const second=scalar(b,'select public.qr_place($1,$2,$3,$4,$5) result',[token,'b'.repeat(64),key,items,table]);second.catch(()=>{});
  await waiting(b);await a.query('COMMIT');await assert.rejects(second,/QR_SESSION_CONFLICT/);
  const privateView=await scalar(b,'select public.qr_track($1,$2) result',[token,'b'.repeat(64)]);assert.deepEqual(privateView,{requests:[],bills:[],calls:[]});
});
