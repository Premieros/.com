// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const branch = '10000000-0000-4000-8000-000000000001';
const table = '30000000-0000-4000-8000-000000000001';
const product = '40000000-0000-4000-8000-000000000001';
const outsiderProduct = '40000000-0000-4000-8000-000000000002';
const user = '20000000-0000-4000-8000-000000000001';
const key = '50000000-0000-4000-8000-000000000001';
const item = { product_id: product, quantity: 2, price: 25, notes: '' };

describe('QR migration on isolated PostgreSQL with deployed order functions and guards', () => {
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
  }, 30_000);
  beforeEach(async () => {
    await db.exec('RESET ROLE');
    await db.exec("select set_config('request.jwt.claim.sub','',false); TRUNCATE qr_private.requests,qr_private.table_links,qr_private.menu_products,public.order_items,public.order_kitchen_sends,public.orders CASCADE; UPDATE public.products SET sale_price=25,is_active=true WHERE name='Tea'; DELETE FROM public.product_modifier_group_products; DELETE FROM public.product_modifier_groups;");
    await staff();
    await scalar('select public.qr_configure($1,$2) result', [branch, [product]]);
    token = await scalar<string>('select public.qr_rotate($1,true) result', [table]);
  });
  afterAll(async () => { await db?.close(); });

  it('publishes a minimal branch menu without granting table or staff RPC access to anon', async () => {
    await anon();
    const menu = await scalar<{ products: unknown[] }>('select public.qr_menu($1) result', [token]);
    expect(menu.products).toEqual([{ id: product, name: 'Tea', description: null, price: 25 }]);
    await expect(db.query('select * from qr_private.requests')).rejects.toThrow(/permission denied/);
    await expect(db.query('select public.qr_inbox($1)', [branch])).rejects.toThrow(/permission denied/);
    await expect(db.query('select public.qr_menu($1)', ['x'.repeat(64)])).rejects.toThrow('QR_LINK_INVALID');
  });
  it('does not expose or accept cross-branch, inactive, unpublished, or mandatory modifier products', async () => {
    await expect(submit([{ ...item, product_id: outsiderProduct }])).rejects.toThrow('QR_PRODUCT_UNAVAILABLE');
    await db.exec('RESET ROLE');
    await db.exec(`INSERT INTO public.product_modifier_groups VALUES('60000000-0000-4000-8000-000000000001','${branch}',true,1); INSERT INTO public.product_modifier_group_products VALUES('60000000-0000-4000-8000-000000000001','${product}','${branch}');`);
    await anon();
    expect((await scalar<{products: unknown[]}>('select public.qr_menu($1) result', [token])).products).toEqual([]);
    await expect(submit()).rejects.toThrow('QR_PRODUCT_UNAVAILABLE');
  });
  it('rejects branch spoofing, bad prices, quantities, duplicate lines, and oversized payloads', async () => {
    await expect(submit([{ ...item, price: 0 }])).rejects.toThrow('QR_PRICE_CHANGED');
    for (const quantity of [0, -1, 1.5, 100]) await expect(submit([{ ...item, quantity }])).rejects.toThrow('QR_INVALID_ITEMS');
    await expect(submit([item, item])).rejects.toThrow('QR_DUPLICATE_PRODUCT');
    await expect(submit([{ ...item, notes: 'x'.repeat(301) }])).rejects.toThrow('QR_INVALID_ITEMS');
    const r = await submit([{ ...item, branch_id: 'spoof' } as typeof item]);
    await db.exec('RESET ROLE');
    expect(await scalar('select branch_id result from qr_private.requests where id=$1', [r.id])).toBe(branch);
  });
  it('keeps retries stable and rejects a changed payload under the same key', async () => {
    const r = await submit();
    expect(await submit()).toEqual(r);
    await expect(submit([{ ...item, quantity: 3 }])).rejects.toThrow('QR_IDEMPOTENCY_CONFLICT');
    await db.exec('RESET ROLE');
    expect(await scalar('select count(*)::int result from public.orders')).toBe(0);
  });
  it('atomically accepts once into real orders, prices, taxes, and existing table check', async () => {
    const r = await submit();
    const accepted = await decide(r.id);
    expect(await decide(r.id)).toEqual(accepted);
    expect(await submit()).toEqual({ id: r.id, status: 'accepted' });
    const more = await submit([item], '50000000-0000-4000-8000-000000000002');
    expect((await decide(more.id)).order_id).toBe(accepted.order_id);
    await db.exec('RESET ROLE');
    expect(await scalar('select count(*)::int result from public.orders')).toBe(1);
    expect(await scalar('select count(*)::int result from public.order_items')).toBe(1);
    expect(await scalar('select quantity::int result from public.order_items')).toBe(4);
    expect(await scalar('select total::float result from public.orders')).toBe(114);
    expect(await scalar('select qr_revision::int result from public.orders')).toBe(2);
    expect(await scalar('select count(*)::int result from public.order_kitchen_sends')).toBe(0);
  });
  it('rolls back price drift at acceptance without creating orders or deciding the request', async () => {
    const r = await submit();
    await db.exec('RESET ROLE; UPDATE public.products SET sale_price=30');
    await expect(decide(r.id)).rejects.toThrow('QR_PRICE_CHANGED');
    await db.exec('RESET ROLE');
    expect(await scalar('select count(*)::int result from public.orders')).toBe(0);
    expect(await scalar('select status result from qr_private.requests')).toBe('pending');
  });
  it('denies cross-branch staff and another operator; rejection is terminal and idempotent', async () => {
    const r = await submit();
    await staff('20000000-0000-4000-8000-000000000002');
    await expect(db.query('select public.qr_decide($1,true)', [r.id])).rejects.toThrow('QR_PERMISSION_DENIED');
    const accepted = await decide(r.id);
    const next = await submit([item], '50000000-0000-4000-8000-000000000002');
    await staff('20000000-0000-4000-8000-000000000003');
    await expect(db.query('select public.qr_decide($1,true)', [next.id])).rejects.toThrow('QR_ORDER_OPERATOR_REQUIRED');
    expect((await decide(next.id, false)).status).toBe('rejected');
    expect((await decide(next.id, false)).status).toBe('rejected');
    await expect(decide(next.id)).rejects.toThrow('QR_ALREADY_DECIDED');
    expect(accepted.order_id).toBeTruthy();
  });
  it('revokes old tokens and rate limits new submissions while allowing retries', async () => {
    const r = await submit();
    for (let n = 2; n <= 10; n++) await submit([item], `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
    await expect(submit([item], '50000000-0000-4000-8000-000000000011')).rejects.toThrow('QR_RATE_LIMITED');
    expect(await submit()).toEqual(r);
    await staff();
    await scalar('select public.qr_rotate($1,false) result', [table]);
    await expect(submit()).rejects.toThrow('QR_LINK_INVALID');
  });
  it('rejects stale full-cart saves, and allows a freshly hydrated revision', async () => {
    const r = await submit(); const accepted = await decide(r.id);
    const payload = { p_order_id: accepted.order_id, p_order_type: 'dine_in', p_table_id: table,
      p_items: [{ ...item, unit_name: 'piece', unit_price: 25 }], p_status: 'open' };
    await expect(db.query('select public.qr_save_order(0,$1)', [JSON.stringify(payload)])).rejects.toThrow('QR_ORDER_REFRESH_REQUIRED');
    const result = await scalar<{success:boolean}>('select public.qr_save_order(1,$1) result', [JSON.stringify(payload)]);
    expect(result.success).toBe(true);
    const direct = await scalar<{error:string}>('select public.update_order(p_order_id=>$1,p_items=>$2) result', [accepted.order_id, JSON.stringify(payload.p_items)]);
    expect(direct.error).toBe('QR_ORDER_REFRESH_REQUIRED');
  });
  it('expires pending requests and never appends a request to a replacement table session', async () => {
    const first = await submit(); await decide(first.id);
    const pending = await submit([item], '50000000-0000-4000-8000-000000000002');
    await db.exec("RESET ROLE; select set_config('request.jwt.claim.sub','',false); UPDATE public.orders SET status='completed';");
    await expect(decide(pending.id)).rejects.toThrow('QR_TABLE_SESSION_CHANGED');
    await db.exec("RESET ROLE; UPDATE qr_private.requests SET created_at=now()-interval '31 minutes' WHERE status='pending'");
    await expect(decide(pending.id)).rejects.toThrow('QR_REQUEST_EXPIRED');
    expect((await decide(pending.id, false)).status).toBe('rejected');
  });
  it('preserves prior discounts and branch tax when adding accepted lines', async () => {
    const first = await submit(); const accepted = await decide(first.id);
    await db.exec("RESET ROLE; select set_config('request.jwt.claim.sub','',false); UPDATE public.order_items SET discount_amount=5");
    const pending = await submit([item], '50000000-0000-4000-8000-000000000002');
    await decide(pending.id);
    await db.exec('RESET ROLE');
    expect(await scalar('select total::float result from public.orders where id=$1', [accepted.order_id])).toBe(108.3);
  });
  it('adds only an unsent quantity delta to a previously sent matching line', async () => {
    const first = await submit(); const accepted = await decide(first.id);
    await db.exec('RESET ROLE');
    const originalId = await scalar<string>('select id result from public.order_items');
    await db.query('insert into public.order_kitchen_sends(order_id,order_item_id,sent_quantity) values($1,$2,2)', [accepted.order_id, originalId]);
    const pending = await submit([item], '50000000-0000-4000-8000-000000000002');
    await decide(pending.id);
    await db.exec('RESET ROLE');
    expect(await scalar('select id result from public.order_items')).toBe(originalId);
    expect(await scalar('select quantity::int result from public.order_items')).toBe(4);
    expect(await scalar('select sent_quantity::int result from public.order_kitchen_sends')).toBe(2);
    expect(await scalar('select count(*)::int result from public.order_kitchen_inventory_events')).toBe(0);
  });
});
