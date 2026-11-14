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
  for (const path of ['tests/fixtures/qr-base.sql','tests/fixtures/qr-deployed-order-functions.sql','tests/fixtures/qr-deployed-triggers.sql']) await admin.query(readFileSync(path,'utf8'));
  await admin.query(`CREATE TRIGGER pricing BEFORE INSERT OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public._price_order_item_modifiers();
    CREATE TRIGGER totals AFTER INSERT OR UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public._sync_order_totals_from_items();
    CREATE TRIGGER ownership BEFORE INSERT OR UPDATE OR DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_pos_operator_ownership();
    CREATE TRIGGER ownership BEFORE INSERT OR UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.guard_pos_operator_ownership();
    CREATE TRIGGER permission BEFORE INSERT OR UPDATE OR DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.enforce_pos_permission_mutation();
    CREATE TRIGGER permission BEFORE INSERT OR UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.enforce_pos_permission_mutation();`);
  await admin.query(readFileSync('supabase/migrations/20261114001719_premier_qr_table_ordering.sql','utf8'));
});
beforeEach(async () => {
  await a.query('ROLLBACK'); await b.query('ROLLBACK');
  await admin.query('TRUNCATE qr_private.requests,qr_private.table_links,qr_private.menu_products,public.orders,public.order_items,public.order_kitchen_sends CASCADE');
  await staff(a); await staff(b);
  await a.query('select public.qr_configure($1,$2)',[branch,[product]]);
  token = await scalar(a,'select public.qr_rotate($1,true) result',[table]);
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
  await waiting(b); await a.query('COMMIT');
  assert.equal((await accepted).order_id,created.order_id);
  assert.equal(await scalar(admin,'select count(*)::int result from public.orders'),1);
  assert.equal(await scalar(admin,'select count(*)::int result from public.order_items'),1);
  assert.equal(await scalar(admin,'select quantity::int result from public.order_items'),4);
});
