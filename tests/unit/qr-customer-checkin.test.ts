// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const branch = '10000000-0000-4000-8000-000000000001';
const table = '30000000-0000-4000-8000-000000000001';
const product = '40000000-0000-4000-8000-000000000001';
const second = '30000000-0000-4000-8000-000000000002';
const user = '20000000-0000-4000-8000-000000000001';
const key = '50000000-0000-4000-8000-000000000001';
const item = { product_id: product, quantity: 2, price: 25, notes: '' };

describe('Phone check-in and private table visits on PostgreSQL', () => {
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
    await db.exec(sqlFile('supabase/migrations/20260909225500_pos_service_order_details.sql'));
    await db.exec(sqlFile('supabase/migrations/20261114093244_customer_checkin_qr_table_ordering.sql'));
  }, 30_000);
  beforeEach(async () => {
    await db.exec('RESET ROLE');
    await db.exec("select set_config('request.jwt.claim.sub','',false); TRUNCATE qr_private.service_calls,public.sales,public.order_kitchen_inventory_events,qr_private.branch_settings,qr_private.requests,qr_private.table_links,qr_private.menu_products,public.order_items,public.order_kitchen_sends,public.orders CASCADE; UPDATE public.dining_tables SET status='vacant',is_active=true; UPDATE public.users SET role='cashier'; UPDATE public.products SET sale_price=25,is_active=true WHERE name='Tea'; DELETE FROM public.product_modifier_group_products; DELETE FROM public.product_modifier_groups;");
    await staff();
    await scalar('select public.qr_configure($1,$2) result', [branch, [product]]);
    token = await scalar<string>('select public.qr_rotate($1,true) result', [table]);
    await scalar('select public.qr_save_customer_settings($1,true,$2,$3,true) result',[branch,{},[]]);
  });
  afterAll(async () => { await db?.close(); });


  type Result = { id: string; recovery_code: string; order_id: string; status: string };
  type View = { bills: import('../../src/features/qr/service').GuestBill[]; requests: import('../../src/features/qr/service').GuestRequest[]; calls: import('../../src/features/qr/service').ServiceCall[]; visit: { closed: boolean } };
  const session='a'.repeat(64),other='b'.repeat(64),phone='01012345678';
  const photo='data:image/jpeg;base64,/9j/'+ 'A'.repeat(80);
  async function begin(type='dine_in',target: string | null=table,secret=session,mobile=phone){await anon();return scalar<Result>('select public.qr_guest_begin($1,$2,$3,$4,$5,$6,$7,$8) result',[token,secret,mobile,'عميل اختبار',type,target,type==='dine_in'?photo:null,type==='delivery'?'عنوان توصيل تجريبي':null]);}
  async function place(secret=session,k=key,target: string | null=table,price=25){await anon();return scalar<Result>('select public.qr_guest_place($1,$2,$3,$4,$5) result',[token,secret,k,JSON.stringify([{...item,price}]),target]);}
  async function track(secret=session){await anon();return scalar<View>('select public.qr_guest_track($1,$2) result',[token,secret]);}
  async function resume(code:string,secret=other){await anon();return scalar<Result>('select public.qr_guest_resume($1,$2,$3,$4) result',[token,secret,phone,code]);}
  async function approve(id:string,target: string | null=table){await staff();return scalar<Result>('select public.qr_review($1,true,$2) result',[id,target]);}
  it('requires name once, protects old APIs, and never exposes another phone account',async()=>{
    await anon();expect(await scalar('select public.qr_guest_lookup($1,$2,$3) result',[token,session,phone])).toMatchObject({registered:false,needs_pin:false});
    await expect(scalar('select public.qr_guest_begin($1,$2,$3,\'\',\'delivery\',null,null,\'عنوان تجريبي\') result',[token,session,phone])).rejects.toThrow('QR_NAME_REQUIRED');
    const v=await begin();expect(v).toMatchObject({order_type:'dine_in',table_id:table});
    expect(await scalar('select public.qr_guest_entry($1,$2) result',[token,session])).toMatchObject({visit:{id:v.id}});
    await expect(scalar('select public.qr_menu($1) result',[token])).rejects.toThrow('QR_CHECKIN_REQUIRED');
    await expect(scalar('select public.qr_submit($1,$2,$3) result',[token,key,JSON.stringify([item])])).rejects.toThrow('QR_CHECKIN_REQUIRED');
    await expect(scalar('select public.qr_place($1,$2,$3,$4,$5) result',[token,session,key,JSON.stringify([item]),table])).rejects.toThrow('QR_CHECKIN_REQUIRED');
    expect(await scalar('select public.qr_guest_lookup($1,$2,$3) result',[token,other,phone])).toMatchObject({registered:true,needs_pin:false});
    expect((await track(other)).bills).toEqual([]);await expect(place(other)).rejects.toThrow('QR_CHECKIN_REQUIRED');
    await expect(db.query('select * from qr_private.visits')).rejects.toThrow(/permission denied/);
    await expect(db.query('select qr_private.new_pin($1)',[v.id])).rejects.toThrow(/permission denied/);
  });
  it('does not require a PIN for an abandoned menu before any request is submitted',async()=>{
    const old=await begin();const next=await begin('delivery',null,other);
    expect(next.id).not.toBe(old.id);expect((await track(session)).visit.closed).toBe(true);
    const r=await place(other,key,null);expect(r.recovery_code).toMatch(/^\d{2}$/);
    await anon();expect(await scalar('select public.qr_guest_lookup($1,$2,$3) result',[token,session,phone])).toMatchObject({registered:true,needs_pin:true,pin_set:true});
  });
  it('binds photos and tables, requires staff verification, verifies prices and preserves idempotency',async()=>{
    await anon();await expect(scalar('select public.qr_guest_begin($1,$2,$3,$4,\'dine_in\',$5,null,null) result',[token,session,phone,'عميل',table])).rejects.toThrow('QR_PHOTO_REQUIRED');
    const v=await begin();await expect(place(session,key,second)).rejects.toThrow('QR_TABLE_LOCKED');await expect(place(session,key,table,1)).rejects.toThrow('QR_PRICE_CHANGED');
    const r=await place();expect(r.recovery_code).toMatch(/^\d{2}$/);expect((await place()).id).toBe(r.id);
    await expect(approve(r.id)).rejects.toThrow('QR_PHOTO_REVIEW_REQUIRED');await staff();expect(await scalar('select public.qr_guest_photo($1,true) result',[v.id])).toBe(photo);
    const accepted=await approve(r.id,second);expect(accepted.status).toBe('accepted');expect((await track()).bills[0].table_id).toBe(second);
    await expect(place(session,'50000000-0000-4000-8000-000000000002',table)).rejects.toThrow('QR_TABLE_LOCKED');
    const follow=await place(session,'50000000-0000-4000-8000-000000000002',second);expect((await approve(follow.id,second)).order_id).toBe(accepted.order_id);
    expect((await track()).bills[0].items[0].quantity).toBe(4);
  });
  it('locks after three wrong codes, lets staff reset, transfers devices and ends access on bill close',async()=>{
    const v=await begin();const r=await place();const wrong=r.recovery_code==='00'?'01':'00';
    expect(await resume(wrong)).toMatchObject({success:false,error:'QR_PIN_INVALID'});await resume(wrong);expect(await resume(wrong)).toMatchObject({error:'QR_PIN_LOCKED'});expect(await resume(r.recovery_code)).toMatchObject({error:'QR_PIN_LOCKED'});
    await staff();const code=await scalar<string>('select public.qr_guest_reset_pin($1) result',[v.id]);expect(await resume(code)).toMatchObject({success:true,visit:{id:v.id}});
    expect((await track(session)).requests).toEqual([]);expect((await track(other)).requests).toHaveLength(1);
    await staff();await scalar('select public.qr_guest_photo($1,true) result',[v.id]);const a=await approve(r.id);
    await db.exec('RESET ROLE'); await db.query("UPDATE public.orders SET status='completed' WHERE id=$1",[a.order_id]);
    expect((await track(other)).visit.closed).toBe(true);expect((await track(other)).bills).toEqual([]);await expect(place(other)).rejects.toThrow('QR_VISIT_CLOSED');
  });
  it('uses canonical delivery orders without a table, supports followups, calls, and safe retries',async()=>{
    await begin('delivery',null);const r=await place(session,key,null);const a=await approve(r.id,null);expect((await approve(r.id,null)).order_id).toBe(a.order_id);
    const view=await track();expect(view.bills).toHaveLength(1);expect(view.bills[0]).toMatchObject({table_name:'طلب توصيل',total:57});
    const follow=await place(session,'50000000-0000-4000-8000-000000000002',null);expect((await approve(follow.id,null)).order_id).toBe(a.order_id);
    await anon();const c=await scalar<Result>('select public.qr_guest_call($1,$2,$3,null,\'check\',\'\') result',[token,session,key]);expect((await track()).calls[0].id).toBe(c.id);
    await db.exec('RESET ROLE');const order=await scalar<Result>('select to_jsonb(o) result from public.orders o where id=$1',[a.order_id]);expect(order).toMatchObject({table_id:null,order_type:'delivery',service_details:{phone:'+201012345678',address:'عنوان توصيل تجريبي'}});
  });
  it('saves delivery with the current QR revision and rejects a stale POS draft',async()=>{
    await begin('delivery',null);const r=await place(session,key,null);const a=await approve(r.id,null);
    const payload={p_order_id:a.order_id,p_order_type:'delivery',p_items:[{product_id:product,unit_name:'piece',quantity:2,unit_price:25,notes:''}],p_status:'held'};
    const saved=await scalar('select public.qr_save_service_order(1,$1,null) result',[JSON.stringify(payload)]);expect(saved).toMatchObject({success:true});
    const follow=await place(session,'50000000-0000-4000-8000-000000000002',null);await approve(follow.id,null);
    await expect(scalar('select public.qr_save_service_order(1,$1,null) result',[JSON.stringify(payload)])).rejects.toThrow('QR_ORDER_REFRESH_REQUIRED');
    expect((await track()).bills[0].items[0].quantity).toBe(4);
  });
  it('restricts staff photo and recovery to the branch and ends visits manually',async()=>{
    const v=await begin();await place();await staff('20000000-0000-4000-8000-000000000002');await expect(scalar('select public.qr_guest_photo($1,false) result',[v.id])).rejects.toThrow();await expect(scalar('select public.qr_guest_reset_pin($1) result',[v.id])).rejects.toThrow();
    await staff();expect(await scalar<unknown[]>('select public.qr_guest_visits($1) result',[branch])).toHaveLength(1);await scalar('select public.qr_guest_end($1) result',[v.id]);expect((await track()).visit.closed).toBe(true);
    await begin('delivery',null,other);expect((await track(other)).requests).toEqual([]);
  });
});


