import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

// Isolated CI Postgres only: all fixture writes are enclosed in a transaction
// and rolled back, never used against the production database.
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL is required');

describe('Shared sale fallback material and negative inventory', () => {
  const db = new Client({ connectionString });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('creates one 1:1 same-name material, deducts below zero, reuses mapping and isolates branches', async () => {
    await db.query('BEGIN');
    try {
      const { rows: [org] } = await db.query<{ id: string }>(
        "insert into public.organizations(name) values('CI AUTO RAW ISOLATION') returning id",
      );
      const { rows: branches } = await db.query<{ id: string }>(
        "insert into public.branches(name,organization_id) values ('CI RAW A',$1),('CI RAW B',$1) returning id",
        [org.id],
      );
      expect(branches).toHaveLength(2);
      const ids = branches.map(b => b.id);
      const { rows: warehouses } = await db.query<{ id: string; branch_id: string }>(
        "insert into public.warehouses(name,branch_id,is_default) values ('CI Warehouse A',$1,true),('CI Warehouse B',$2,true) returning id,branch_id",
        ids,
      );
      const { rows: products } = await db.query<{ id: string; branch_id: string; name: string }>(
        "insert into public.products(name,branch_id,sale_price,cost_price) values ('Same Name CI',$1,55,0),('Same Name CI',$2,55,0) returning id,branch_id,name",
        ids,
      );
      for (const p of products) {
        const { rows: [mapped] } = await db.query<{ payload: { action: string; raw_material_id?: string } }>(
          'select public._ensure_sale_auto_raw_recipe($1::uuid,$2::uuid) as payload',
          [p.branch_id,p.id],
        );
        expect(mapped.payload.action).toBe('auto_linked');
        const { rows: [again] } = await db.query<{ payload: { action: string } }>(
          'select public._ensure_sale_auto_raw_recipe($1::uuid,$2::uuid) as payload',
          [p.branch_id,p.id],
        );
        expect(again.payload.action).toBe('existing_stock_configuration');
        const { rows: [recipeCount] } = await db.query<{ n: string }>(
          'select count(*) n from public.recipes where product_id=$1',
          [p.id],
        );
        expect(Number(recipeCount.n)).toBe(1);
        const { rows: [raw] } = await db.query<{ id: string; name: string; branch_id: string }>(
          `select rm.id,rm.name,rm.branch_id
           from public.recipe_items ri
           join public.recipes r on r.id=ri.recipe_id
           join public.raw_materials rm on rm.id=ri.raw_material_id
           where r.product_id=$1`,
          [p.id],
        );
        expect(raw.name).toBe(p.name);
        expect(raw.branch_id).toBe(p.branch_id);
        expect(raw.id).toBe(mapped.payload.raw_material_id);
      }
      const a = products[0];
      const wh = warehouses.find(w => w.branch_id===a.branch_id);
      expect(wh).toBeDefined();
      const { rows: [result] } = await db.query<{ payload: {
        success: boolean; raw_materials_deducted: unknown[]; ready_products_deducted: unknown[];
        raw_oversold: unknown[];
      } }>(
        `select public._deduct_sale_inventory_with_modifiers_core(
           $1::uuid,$2::uuid,$3::jsonb,gen_random_uuid(),'CI-AUTO-RAW') as payload`,
        [a.branch_id,wh?.id,JSON.stringify([{product_id:a.id,quantity:2}])],
      );
      expect(result.payload.success).toBe(true);
      expect(result.payload.raw_materials_deducted).toHaveLength(1);
      expect(result.payload.ready_products_deducted).toHaveLength(0);
      const { rows: balances } = await db.query<{ branch_id: string; qty: string }>(
        `select r.branch_id,coalesce(sum(b.quantity),0) qty
         from public.recipes r
         join public.recipe_items ri on ri.recipe_id=r.id
         left join public.raw_material_batches b on b.raw_material_id=ri.raw_material_id
         where r.product_id=any($1::uuid[])
         group by r.branch_id order by r.branch_id`,
        [products.map(p=>p.id)],
      );
      expect(Number(balances.find(b=>b.branch_id===a.branch_id)?.qty)).toBe(-2);
      expect(Number(balances.find(b=>b.branch_id!==a.branch_id)?.qty)).toBe(0);
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('keeps generated sale helper inaccessible to browser roles', async () => {
    const { rows: [roles] } = await db.query<{ anon: boolean; authenticated: boolean }>(`
      select has_function_privilege('anon','public._ensure_sale_auto_raw_recipe(uuid,uuid)','EXECUTE') anon,
             has_function_privilege('authenticated','public._ensure_sale_auto_raw_recipe(uuid,uuid)','EXECUTE') authenticated`);
    expect(roles.anon).toBe(false);
    expect(roles.authenticated).toBe(false);
  });
});
