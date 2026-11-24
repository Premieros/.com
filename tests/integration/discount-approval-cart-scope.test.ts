import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const url = process.env.SUPABASE_DB_URL;
const disposable = Boolean(url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname));
(disposable ? describe : describe.skip)('discount approval cart scope', () => {
  it('binds quantities, products, modifiers and duplicate lines without trusting display price or line order', async () => {
    const db = new Client({connectionString:url});
    await db.connect();
    try {
      const a = {product_id:'a',unit_name:'piece',quantity:1,discount_amount:0,bonus_quantity:0,modifier_option_ids:['m2','m1'],unit_price:10};
      const b = {...a,product_id:'b'};
      const compare = async (left: unknown, right: unknown) => {
        const {rows} = await db.query<{same:boolean|null}>(
          'select public.discount_approval_cart($1::jsonb) = public.discount_approval_cart($2::jsonb) same',
          [JSON.stringify(left),JSON.stringify(right)]);
        return rows[0].same;
      };
      expect(await compare([a,b],[b,{...a,modifier_option_ids:['m1','m2'],unit_price:20}])).toBe(true);
      expect(await compare([a],[b])).toBe(false);
      expect(await compare([a],[{...a,quantity:2}])).toBe(false);
      expect(await compare([a],[{...a,modifier_option_ids:['m1']}])).toBe(false);
      expect(await compare([a],[a,a])).toBe(false);
      expect(await compare([],[])).toBeNull();
      const {rows} = await db.query<{proname:string,body:string}>(
        "select proname,pg_get_functiondef(oid) body from pg_proc where pronamespace='public'::regnamespace and proname in ('process_sale','process_sale_split')");
      expect(new Set(rows.map(r=>r.proname))).toEqual(new Set(['process_sale','process_sale_split']));
      for (const row of rows) expect(row.body).toContain("public.discount_approval_cart(payload->'cart') = public.discount_approval_cart(p_items)");
    } finally { await db.end(); }
  });
});
