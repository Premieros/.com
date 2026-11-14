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

describe('Customer choice, reassignment and branch settings on PostgreSQL', () => {
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
    await db.exec(`ALTER TABLE public.users ADD COLUMN role text DEFAULT 'cashier'; ALTER TABLE public.products ADD COLUMN image_url text, ADD COLUMN category_id uuid;
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
  }, 30_000);
  beforeEach(async () => {
    await db.exec('RESET ROLE');
    await db.exec("select set_config('request.jwt.claim.sub','',false); TRUNCATE qr_private.branch_settings,qr_private.requests,qr_private.table_links,qr_private.menu_products,public.order_items,public.order_kitchen_sends,public.orders CASCADE; UPDATE public.dining_tables SET status='vacant',is_active=true; UPDATE public.users SET role='cashier'; UPDATE public.products SET sale_price=25,is_active=true WHERE name='Tea'; DELETE FROM public.product_modifier_group_products; DELETE FROM public.product_modifier_groups;");
    await staff();
    await scalar('select public.qr_configure($1,$2) result', [branch, [product]]);
    token = await scalar<string>('select public.qr_rotate($1,true) result', [table]);
  });
  afterAll(async () => { await db?.close(); });

  async function selected(target = second, requestKey = key, items = [item]) {
    await anon();
    return scalar<{id:string;status:string}>('select public.qr_submit_selected($1,$2,$3,$4) result',[token,requestKey,JSON.stringify(items),target]);
  }
  async function review(id:string,target=second,accept=true) {
    await staff();
    return scalar<{order_id:string;status:string}>('select public.qr_review($1,$2,$3) result',[id,accept,target]);
  }
  it('exposes only active tables in the link branch, and customer chooses a different table',async()=>{
    await anon();
    const menu=await scalar<{tables:{id:string}[]}>('select public.qr_menu($1) result',[token]);
    expect(menu.tables.map(t=>t.id)).toEqual([table,second]);
    const r=await selected();
    const accepted=await review(r.id);
    expect((await review(r.id)).order_id).toBe(accepted.order_id);
    await db.exec('RESET ROLE');
    expect(await scalar('select table_id result from public.orders')).toBe(second);
    expect(await scalar('select count(*)::int result from public.orders')).toBe(1);
    expect(await scalar('select requested_table_id result from qr_private.requests')).toBe(second);
    expect(await scalar('select assigned_table_id result from qr_private.requests')).toBe(second);
  });
  it('binds idempotency to the original table and payload, even after rerouting',async()=>{
    const r=await selected(table);
    expect(await selected(table)).toEqual(r);
    await expect(selected(second)).rejects.toThrow('QR_IDEMPOTENCY_CONFLICT');
    await expect(selected(table,key,[{...item,quantity:3}])).rejects.toThrow('QR_IDEMPOTENCY_CONFLICT');
    const accepted=await review(r.id,second);
    expect((await selected(table)).status).toBe('accepted');
    expect((await review(r.id,second)).order_id).toBe(accepted.order_id);
    await expect(review(r.id,table)).rejects.toThrow('QR_ALREADY_DECIDED');
    await db.exec('RESET ROLE');
    expect(await scalar('select requested_table_id result from qr_private.requests')).toBe(table);
    expect(await scalar('select assigned_table_id result from qr_private.requests')).toBe(second);
  });
  it('refuses occupied tables without appending to another bill and allows a vacant alternative',async()=>{
    const first=await selected(table);
    await review(first.id,table);
    const next=await selected(table,'50000000-0000-4000-8000-000000000002');
    await expect(review(next.id,table)).rejects.toThrow('QR_TABLE_BUSY');
    await expect(decide(next.id)).rejects.toThrow('QR_TABLE_BUSY');
    await review(next.id,second);
    await db.exec('RESET ROLE');
    expect(await scalar('select count(*)::int result from public.orders')).toBe(2);
    expect(await scalar('select max(quantity)::int result from public.order_items')).toBe(2);
  });
  it('denies foreign/inactive tables, foreign staff and anon review/settings access',async()=>{
    await expect(selected(foreign)).rejects.toThrow('QR_TABLE_INVALID');
    const r=await selected();
    await expect(review(r.id,foreign)).rejects.toThrow('QR_TABLE_INVALID');
    await staff('20000000-0000-4000-8000-000000000002');
    await expect(db.query('select public.qr_review($1,true,$2)',[r.id,second])).rejects.toThrow('QR_PERMISSION_DENIED');
    await anon();
    await expect(db.query('select public.qr_settings($1)',[branch])).rejects.toThrow(/permission denied/);
    await expect(db.query('select qr_private.decide($1,true)',[r.id])).rejects.toThrow(/permission denied/);
    await db.exec(`RESET ROLE; UPDATE public.dining_tables SET is_active=false WHERE id='${second}'`);
    await expect(selected()).rejects.toThrow('QR_TABLE_INVALID');
  });
  it('uses branch settings for both old and new clients, preserves role restrictions and strips private appearance keys',async()=>{
    await staff();
    await scalar('select public.qr_save_settings($1,false,$2,$3) result',[branch,JSON.stringify({brand_name:'Our menu',secret:'no'}),['manager']]);
    await expect(submit()).rejects.toThrow('QR_DISABLED');
    await expect(selected()).rejects.toThrow('QR_DISABLED');
    await anon(); await expect(db.query('select public.qr_menu($1)',[token])).rejects.toThrow('QR_DISABLED');
    await staff();
    const config=await scalar<{appearance:object}>('select public.qr_settings($1) result',[branch]);
    expect(config.appearance).toEqual({brand_name:'Our menu'});
    await scalar('select public.qr_save_settings($1,true,$2,$3) result',[branch,'{}',['manager']]);
    const r=await selected();
    await expect(review(r.id)).rejects.toThrow('QR_PERMISSION_DENIED');
    await expect(decide(r.id)).rejects.toThrow('QR_PERMISSION_DENIED');
    await db.exec(`RESET ROLE; UPDATE public.users SET role='manager' WHERE id='${user}'`);
    await review(r.id);
  });
  it('rolls back reassignment and acceptance together if price changed',async()=>{
    const r=await selected(table);
    await db.exec('RESET ROLE; UPDATE public.products SET sale_price=30');
    await expect(review(r.id,second)).rejects.toThrow('QR_PRICE_CHANGED');
    await db.exec('RESET ROLE');
    expect(await scalar('select table_id result from qr_private.requests')).toBe(table);
    expect(await scalar('select assigned_table_id result from qr_private.requests')).toBeNull();
    expect(await scalar('select count(*)::int result from public.orders')).toBe(0);
  });
});
