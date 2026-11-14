// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const branch = '10000000-0000-4000-8000-000000000001';
const table = '30000000-0000-4000-8000-000000000001';
const product = '40000000-0000-4000-8000-000000000001';
const second = '30000000-0000-4000-8000-000000000002';
const foreign = '30000000-0000-4000-8000-000000000003';
const user = '20000000-0000-4000-8000-000000000001';
const key = '50000000-0000-4000-8000-000000000001';
const item = { product_id: product, quantity: 2, price: 25, notes: '' };

describe('Private guest tracking, billing and table service on PostgreSQL', () => {
  let db: PGlite;
  let token: string;
  const sqlFile = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  async function scalar<T = unknown>(sql: string, args: unknown[] = []): Promise<T> {
    const result = await db.query<{ result: T }>(sql, args);
    return result.rows[0]?.result;
  }
  async function staff(id = user) {
    await db.exec('RESET ROLE');
    await scalar("select set_config('request.jwt.claim.sub',$1,false) result", [id]);
    await scalar("select set_config('request.jwt.claim.role','authenticated',false) result");
    await db.exec('SET ROLE authenticated');
  }
  async function anon() {
    await db.exec('RESET ROLE');
    await db.exec("select set_config('request.jwt.claim.sub','',false); select set_config('request.jwt.claim.role','anon',false); SET ROLE anon");
  }
  async function submit(items = [item], requestKey = key) {
    await anon();
    return scalar<{ id: string; status: string }>('select public.qr_submit($1,$2,$3) result', [token, requestKey, JSON.stringify(items)]);
  }
  async function decide(id: string, accept = true) {
    await staff();
    return scalar<{ order_id: string; status: string }>('select public.qr_decide($1,$2) result', [id, accept]);
  }
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(sqlFile('tests/fixtures/qr-base.sql'));
    await db.exec(`UPDATE public.users SET permissions=permissions||ARRAY['pos.kds_update','pos.payment.take']; ALTER TABLE public.users ADD COLUMN role text DEFAULT 'cashier'; ALTER TABLE public.products ADD COLUMN image_url text, ADD COLUMN category_id uuid;
      CREATE TABLE public.categories(id uuid PRIMARY KEY,name text,branch_id uuid); CREATE TABLE public.branch_settings(branch_id uuid PRIMARY KEY,currency text);
      INSERT INTO public.dining_tables(id,branch_id,name) VALUES ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Table B'),('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','Private C');`);
    await db.exec(sqlFile('tests/fixtures/qr-deployed-order-functions.sql'));
    await db.exec(sqlFile('tests/fixtures/qr-deployed-triggers.sql'));
    await db.exec(sqlFile('tests/fixtures/qr-deployed-sent-pricing.sql'));
    await db.exec(`
      CREATE TRIGGER pricing BEFORE INSERT OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public._reprice_order_item();
      CREATE TRIGGER sent_guard BEFORE UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.guard_sent_order_item_mutation();
      CREATE TRIGGER totals AFTER INSERT OR UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public._sync_order_totals_from_items();
      CREATE TRIGGER ownership BEFORE INSERT OR UPDATE OR DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_pos_operator_ownership();
      CREATE TRIGGER ownership BEFORE INSERT OR UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.guard_pos_operator_ownership();
      CREATE TRIGGER permission BEFORE INSERT OR UPDATE OR DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.enforce_pos_permission_mutation();
      CREATE TRIGGER permission BEFORE INSERT OR UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.enforce_pos_permission_mutation();
    `);
    await db.exec(sqlFile('supabase/migrations/20261114001719_premier_qr_table_ordering.sql'));
    await db.exec(sqlFile('supabase/migrations/20261114013903_customer_experience_qr_table_ordering.sql'));
    await db.exec(`CREATE TABLE public.sales(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),branch_id uuid,source_order_id uuid,paid_amount numeric,refunded_amount numeric DEFAULT 0);`);
    await db.exec(sqlFile('supabase/migrations/20261114023132_guest_tracking_qr_table_ordering.sql'));
  }, 30_000);
  beforeEach(async () => {
    await db.exec('RESET ROLE');
    await db.exec("select set_config('request.jwt.claim.sub','',false); TRUNCATE qr_private.service_calls,public.sales,public.order_kitchen_inventory_events,qr_private.branch_settings,qr_private.requests,qr_private.table_links,qr_private.menu_products,public.order_items,public.order_kitchen_sends,public.orders CASCADE; UPDATE public.dining_tables SET status='vacant',is_active=true; UPDATE public.users SET role='cashier'; UPDATE public.products SET sale_price=25,is_active=true WHERE name='Tea'; DELETE FROM public.product_modifier_group_products; DELETE FROM public.product_modifier_groups;");
    await staff();
    await scalar('select public.qr_configure($1,$2) result', [branch, [product]]);
    token = await scalar<string>('select public.qr_rotate($1,true) result', [table]);
  });
  afterAll(async () => { await db?.close(); });

  const session='a'.repeat(64), stranger='b'.repeat(64);
  async function place(secret=session,requestKey=key,target=table) {
    await anon();return scalar<{id:string;status:string}>('select public.qr_place($1,$2,$3,$4,$5) result',[token,secret,requestKey,JSON.stringify([item]),target]);
  }
  async function track(secret=session) { await anon();return scalar<import('../../src/features/qr/service').GuestTracking>('select public.qr_track($1,$2) result',[token,secret]); }
  async function call(kind='service',secret=session,requestKey=key,target=table,note='') {
    await anon();return scalar<{id:string;status:string}>('select public.qr_call_service($1,$2,$3,$4,$5,$6) result',[token,secret,requestKey,target,kind,note]);
  }
  it('binds pending requests to an unguessable device secret and prevents key adoption',async()=>{
    const r=await place();expect(await place()).toEqual(r);
    expect((await track()).requests[0].status).toBe('pending');expect((await track()).bills).toEqual([]);
    expect(await track(stranger)).toEqual({requests:[],bills:[],calls:[]});
    await expect(place(stranger)).rejects.toThrow('QR_SESSION_CONFLICT');
    await expect(db.query('select * from qr_private.requests')).rejects.toThrow(/permission denied/);
    await expect(db.query('select public.qr_track($1,$2)',[token,r.id])).rejects.toThrow('QR_LINK_INVALID');
    await submit([item],'50000000-0000-4000-8000-000000000002');
    await expect(place(session,'50000000-0000-4000-8000-000000000002')).rejects.toThrow('QR_SESSION_CONFLICT');
  });
  it('tracks authoritative bill lines, preparation state, tax and payments without staff/private data',async()=>{
    const r=await place();const accepted=await decide(r.id);
    let view=await track();expect(view.bills[0]).toMatchObject({id:accepted.order_id,total:57,tax_amount:7,paid_amount:0,balance:57,table_name:'Table A'});
    expect(view.bills[0].items).toEqual([{name:'Tea',quantity:2,unit_price:25,total:50}]);
    expect(JSON.stringify(view)).not.toMatch(/cashier|guest_hash|customer_id|decided_by/);
    await staff();await db.exec(`RESET ROLE; UPDATE public.orders SET kitchen_status='cooking'; INSERT INTO public.sales(branch_id,source_order_id,paid_amount,refunded_amount) VALUES('${branch}','${accepted.order_id}',40,10);`);
    view=await track();expect(view.bills[0]).toMatchObject({kitchen_status:'cooking',paid_amount:30,refunded_amount:10,balance:17});
    expect((await track(stranger)).bills).toEqual([]);
  });
  it('accepts follow-ups into the same visit bill, while another device cannot join it',async()=>{
    const first=await place();const accepted=await decide(first.id);
    const own=await place(session,'50000000-0000-4000-8000-000000000002');
    await staff();expect(await scalar('select public.qr_inbox($1)->0->>\'own_active_table_id\' result',[branch])).toBe(table);
    expect((await decide(own.id)).order_id).toBe(accepted.order_id);
    const other=await place(stranger,'50000000-0000-4000-8000-000000000003');await expect(decide(other.id)).rejects.toThrow('QR_TABLE_BUSY');
    const view=await track();expect(view.bills).toHaveLength(1);expect(view.bills[0].items[0].quantity).toBe(4);expect(view.bills[0].total).toBe(114);
  });
  it('never follows a later bill at the same table, and expires/revokes the visit scope',async()=>{
    const r=await place();const accepted=await decide(r.id);
    await db.exec(`RESET ROLE; UPDATE public.orders SET status='completed' WHERE id='${accepted.order_id}';`);
    await staff();await scalar('select public.create_order(p_branch_id=>$1,p_table_id=>$2,p_items=>$3) result',[branch,table,JSON.stringify([{...item,unit_price:25,unit_name:'piece'}])]);
    expect((await track()).bills.map(b=>b.id)).toEqual([accepted.order_id]);
    await db.exec("RESET ROLE; UPDATE qr_private.requests SET created_at=now()-interval '25 hours'");
    expect((await track()).requests).toEqual([]);await expect(place(session,'50000000-0000-4000-8000-000000000002')).rejects.toThrow('QR_SESSION_EXPIRED');
    await staff();await scalar('select public.qr_rotate($1,true) result',[table]);await expect(track()).rejects.toThrow('QR_LINK_INVALID');
  });
  it('supports a service call before ordering but requires the private accepted bill for a check',async()=>{
    await expect(call('check')).rejects.toThrow('QR_NO_ACTIVE_BILL');
    const c=await call('service');expect(await call('service')).toEqual(c);
    await expect(call('service',session,key,second)).rejects.toThrow('QR_IDEMPOTENCY_CONFLICT');
    await expect(call('service',stranger,'50000000-0000-4000-8000-000000000003',foreign)).rejects.toThrow('QR_TABLE_INVALID');
    expect((await track()).calls[0]).toMatchObject({id:c.id,status:'open',table_name:'Table A'});expect((await track(stranger)).calls).toEqual([]);
    await anon();await expect(db.query('select public.qr_calls($1)',[branch])).rejects.toThrow(/permission denied/);await expect(db.query('select * from qr_private.service_calls')).rejects.toThrow(/permission denied/);
  });
  it('routes check/service to the staff-assigned table and reports acknowledged/done states',async()=>{
    const r=await place();await staff();await scalar('select public.qr_review($1,true,$2) result',[r.id,second]);
    const c=await call('check');expect((await track()).calls[0].table_name).toBe('Table B');
    await staff('20000000-0000-4000-8000-000000000002');await expect(db.query('select public.qr_handle_call($1,$2)',[c.id,'done'])).rejects.toThrow('QR_PERMISSION_DENIED');
    await staff();await scalar('select public.qr_handle_call($1,$2) result',[c.id,'acknowledged']);expect((await track()).calls[0].status).toBe('acknowledged');
    await staff();await scalar('select public.qr_handle_call($1,$2) result',[c.id,'done']);expect((await track()).calls[0].status).toBe('done');expect(await call('check')).toEqual({id:c.id,status:'done'});
    await staff();expect(await scalar('select public.qr_calls($1) result',[branch])).toEqual([]);await expect(db.query('select public.qr_handle_call($1,$2)',[c.id,'acknowledged'])).rejects.toThrow('QR_ALREADY_DECIDED');
  });
});
