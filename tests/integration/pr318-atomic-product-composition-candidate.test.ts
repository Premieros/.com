import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.SUPABASE_DB_URL;
const disposable = Boolean(url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname));
(disposable ? describe : describe.skip)('PR 318 canonical atomic product composition', () => {
  const db = new Client({ connectionString: url });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });
  it('creates and edits mixed composition with rollback and stale-snapshot rejection', async () => {
    const org=randomUUID(), branch=randomUUID(), other=randomUUID(), user=randomUUID(), measure=randomUUID(), raw=randomUUID(), group=randomUUID(), foreignGroup=randomUUID();
    const tag=randomUUID().slice(0,8), email='atomic-'+tag+'@ci.invalid';
    await db.query('BEGIN');
    try {
      await db.query("insert into public.roles(role,name_ar,name_en,permissions,scope,is_active) values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true) on conflict(role) do nothing");
      await db.query('insert into public.organizations(id,name,slug) values($1,$2,$3)',[org,'CI Atomic','ci-atomic-'+tag]);
      await db.query("insert into public.branches(id,name,is_active,organization_id) values($1,'CI Atomic',true,$3),($2,'CI Other',true,$3)",[branch,other,org]);
      await db.query('insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())',[user,email]);
      await db.query("select set_config('app.register_branch','on',true)");
      await db.query("insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,'CI Atomic','super_admin',$3,true)",[user,email,branch]);
      await db.query("select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true),set_config('app.register_branch','off',true)",[user,JSON.stringify({sub:user,role:'authenticated'})]);
      await db.query("insert into public.measurement_units(id,code,name,symbol,is_active) values($1,$2,'CI Unit','u',true)",[measure,'CI-A-'+tag]);
      await db.query("insert into public.raw_materials(id,code,name,unit_id,default_cost,is_active,branch_id) values($1,$2,'CI Raw',$3,2,true,$4)",[raw,'CI-R-'+tag,measure,branch]);
      await db.query("insert into public.inventory_units(id,code,name,unit_type,branch_id,is_active) values($1,$2,'CI Group','manufactured',$3,true),($4,$5,'CI Other Group','manufactured',$6,true)",[group,'CI-G-'+tag,branch,foreignGroup,'CI-F-'+tag,other]);
      const call='select public.create_product_operational($1,$2) result';
      const base={p_name:'CI Mixed',p_branch_id:branch,p_sku:'CI-MIX-'+tag,p_sale_price:10,p_unit_links:[{unit_id:group,quantity:0.5}],p_business_attributes:{ci_marker:'atomic'}};
      const items=[{raw_material_id:raw,quantity:2,wastage_percent:1}];
      await db.query('SET LOCAL ROLE authenticated');
      const {rows}=await db.query(call,[base,JSON.stringify(items)]);
      expect(rows[0].result.success).toBe(true);
      const pid=rows[0].result.product_id;
      const ready=(await db.query(call,[{...base,p_name:'CI Ready',p_sku:'CI-READY-'+tag,p_unit_links:[],p_business_attributes:{}},'[]'])).rows[0].result;
      const groupOnly=(await db.query(call,[{...base,p_name:'CI Group Only',p_sku:'CI-GROUP-'+tag,p_business_attributes:{}},'[]'])).rows[0].result;
      expect(ready.success).toBe(true);
      expect(groupOnly.success).toBe(true);
      await db.query('RESET ROLE');
      expect((await db.query('select product_type from public.products where id=$1',[ready.product_id])).rows[0].product_type).toBe('ready');
      expect((await db.query('select product_type from public.products where id=$1',[groupOnly.product_id])).rows[0].product_type).toBe('manufactured');
      expect((await db.query('select count(*)::int n from public.recipes where product_id=any($1::uuid[])',[[ready.product_id,groupOnly.product_id]])).rows[0].n).toBe(0);
      expect((await db.query('select quantity::float8 qty from public.product_unit_links where product_id=$1',[groupOnly.product_id])).rows[0].qty).toBe(.5);
      expect((await db.query("select p.business_attributes attrs, r.yield_quantity::float8 yield, i.quantity::float8 raw_qty, l.quantity::float8 group_qty from public.products p join public.recipes r on r.product_id=p.id join public.recipe_items i on i.recipe_id=r.id join public.product_unit_links l on l.product_id=p.id where p.id=$1",[pid])).rows).toEqual([{attrs:{ci_marker:'atomic'},yield:1,raw_qty:2,group_qty:0.5}]);
      for(const [sku, product, ingredientRows, error] of [
        ['CI-BAD-G-'+tag,{...base,p_unit_links:[{unit_id:foreignGroup,quantity:1}]},items,'INVALID_MANUFACTURED_COMPONENT'],
        ['CI-LATE-'+tag,base,[{raw_material_id:raw,quantity:1e20,wastage_percent:0}],'numeric field overflow'],
      ] as const) {
        await db.query('SAVEPOINT rejected_composition');
        await db.query('SET LOCAL ROLE authenticated');
        await expect(db.query(call,[{...product,p_sku:sku},JSON.stringify(ingredientRows)])).rejects.toThrow(error);
        await db.query('ROLLBACK TO SAVEPOINT rejected_composition');
        await db.query('RESET ROLE');
        expect((await db.query('select id from public.products where sku=$1',[sku])).rowCount).toBe(0);
      }
      expect((await db.query("select has_function_privilege('anon','public.create_product_operational(jsonb,jsonb)','execute') allowed")).rows[0].allowed).toBe(false);
      const editCall='select public.edit_product_operational_composition($1,$2,$3,$4,$5,$6,$7,$8) result';
      const ver=(await db.query('select version from public.recipes where product_id=$1',[pid])).rows[0].version;
      const originalLinks=JSON.stringify([{unit_id:group,quantity:0.5}]);
      const links=JSON.stringify([{unit_id:group,quantity:0.75}]);
      await db.query('SAVEPOINT bad_edit');
      await db.query('SET LOCAL ROLE authenticated');
      await expect(db.query(editCall,[pid,branch,ver,originalLinks,{name:'Must roll back',business_attributes:{ci_marker:'atomic'}},null,JSON.stringify([{raw_material_id:raw,quantity:1e20}]),links])).rejects.toThrow();
      await db.query('ROLLBACK TO SAVEPOINT bad_edit');
      await db.query('RESET ROLE');
      expect((await db.query('select p.name,l.quantity::float8 qty,i.quantity::float8 raw_qty from public.products p join public.product_unit_links l on l.product_id=p.id join public.recipes r on r.product_id=p.id join public.recipe_items i on i.recipe_id=r.id where p.id=$1',[pid])).rows[0]).toEqual({name:'CI Mixed',qty:0.5,raw_qty:2});
      await db.query('SET LOCAL ROLE authenticated');
      expect((await db.query(editCall,[pid,branch,ver,originalLinks,{name:'CI Edited',business_attributes:{ci_marker:'atomic'},sale_price:12},null,JSON.stringify([{raw_material_id:raw,quantity:3,wastage_percent:2}]),links])).rows[0].result.success).toBe(true);
      await db.query('RESET ROLE');
      expect((await db.query('select p.name,p.sale_price::float8 sale_price,l.quantity::float8 group_qty,i.quantity::float8 raw_qty from public.products p join public.product_unit_links l on l.product_id=p.id join public.recipes r on r.product_id=p.id join public.recipe_items i on i.recipe_id=r.id where p.id=$1',[pid])).rows[0]).toEqual({name:'CI Edited',sale_price:12,group_qty:.75,raw_qty:3});
      await db.query('SAVEPOINT stale_edit');
      await db.query('SET LOCAL ROLE authenticated');
      await expect(db.query(editCall,[pid,branch,ver,originalLinks,{name:'Stale'},null,JSON.stringify(items),links])).rejects.toThrow('COMPOSITION_REFRESH_REQUIRED');
      await db.query('ROLLBACK TO SAVEPOINT stale_edit');
      await db.query('RESET ROLE');
      expect((await db.query("select has_function_privilege('anon','public.edit_product_operational_composition(uuid,uuid,integer,jsonb,jsonb,jsonb,jsonb,jsonb)','execute') allowed")).rows[0].allowed).toBe(false);
    } finally { await db.query('ROLLBACK'); }
  });
});
