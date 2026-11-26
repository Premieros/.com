// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { normalizeHistoricalMigrationForCi } from '../../scripts/db/ci-migration-compat.js';

it('prices direct, nested and legacy components at published prices in the active branch', async () => {
  const db = new PGlite();
  const ids = Array.from({ length: 10 }, (_, i) => `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`);
  const [branch, otherBranch, product, legacy, unit, child, raw, unpriced, recipe, ready] = ids.map(id => `'${id}'`);
  try {
    await db.exec(`
      CREATE SCHEMA private;
      CREATE SCHEMA auth;
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT ${branch}::uuid $$;
      CREATE FUNCTION public.is_pos_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION public.user_may_access_branch(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1 = ${branch}::uuid $$;
      CREATE TABLE products(id uuid, branch_id uuid, cost_price numeric);
      CREATE TABLE inventory_units(id uuid, branch_id uuid, name text);
      CREATE TABLE product_unit_links(product_id uuid, unit_id uuid, quantity numeric);
      CREATE TABLE inventory_unit_recipe_units(unit_id uuid, component_unit_id uuid, quantity numeric, wastage_percent numeric);
      CREATE TABLE product_components(product_id uuid, component_product_id uuid, quantity numeric);
      CREATE TABLE recipes(id uuid, product_id uuid, branch_id uuid, yield_quantity numeric, is_active boolean);
      CREATE TABLE recipe_items(recipe_id uuid, raw_material_id uuid, quantity numeric, wastage_percent numeric);
      CREATE TABLE inventory_unit_recipes(unit_id uuid, raw_material_id uuid, quantity numeric, wastage_percent numeric);
      CREATE TABLE raw_materials(id uuid, branch_id uuid, name text);
      CREATE TABLE raw_material_price_events(id uuid, raw_material_id uuid, branch_id uuid, unit_cost numeric, priced_at timestamptz);
      INSERT INTO products VALUES (${product},${branch},99), (${legacy},${branch},88), (${ready},${branch},7), (${otherBranch},${otherBranch},123);
      INSERT INTO inventory_units VALUES (${unit},${branch},'Group'), (${child},${branch},'Nested');
      INSERT INTO product_unit_links VALUES (${product},${unit},2);
      INSERT INTO product_components VALUES (${legacy},${product},3), (${legacy},${ready},4);
      INSERT INTO recipes VALUES (${recipe},${product},${branch},2,true);
      INSERT INTO recipe_items VALUES (${recipe},${raw},4,25);
      INSERT INTO inventory_unit_recipe_units VALUES (${unit},${child},2,0);
      INSERT INTO inventory_unit_recipes VALUES (${child},${raw},0.5,0), (${child},${unpriced},100,0);
      INSERT INTO raw_materials VALUES (${raw},${branch},'Priced'), (${unpriced},${branch},'Unpriced');
      INSERT INTO raw_material_price_events VALUES
        (${product},${raw},${branch},3,now()-interval '2 days'),
        (${legacy},${raw},${branch},10,now()-interval '1 day'),
        (${unit},${raw},${branch},999,now()+interval '1 day');
    `);
    const helperPath = 'supabase/migrations/20261023150600_raw_published_price_asof_helper.sql';
    await db.exec(normalizeHistoricalMigrationForCi(helperPath, readFileSync(helperPath, 'utf8')));
    await db.exec(readFileSync('supabase/migrations/20261126112000_catalog_latest_component_costs.sql', 'utf8'));

    const { rows } = await db.query<{ product_id: string; calculated_cost: string }>('SELECT * FROM public.get_product_live_costs()');
    expect(Object.fromEntries(rows.map(row => [row.product_id, Number(row.calculated_cost)]))).toEqual({
      [ids[2]]: 45, [ids[3]]: 135, [ids[9]]: 7,
    });
    const details = await db.query<{ cost: Record<string, unknown> }>(
      'SELECT public.get_product_operational_composition($1, $2) AS cost', [ids[2], ids[0]],
    );
    expect(details.rows[0].cost).toMatchObject({
      calculated_cost: 45,
      linked_units: [{ unit_cost: 10, line_cost: 20 }],
      direct_raw_materials: [{ unit_cost: 10, line_cost: 25 }],
    });
  } finally {
    await db.close();
  }
}, 15000);
