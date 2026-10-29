import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  throw new Error('SUPABASE_DB_URL is required for database integration tests');
}

describe('Architecture V2 Phase 4D component evidence', () => {
  const client = new Client({ connectionString });

  beforeAll(async () => { await client.connect(); });
  afterAll(async () => { await client.end(); });

  it('keeps line-level evidence private and on the existing insert capture path', async () => {
    const { rows } = await client.query<{
      helper_exists: boolean;
      anon_exec: boolean;
      authenticated_exec: boolean;
      service_exec: boolean;
      capture_calls_helper: boolean;
      capture_fail_closed: boolean;
      capture_preserves_partial_cost: boolean;
      capture_trigger_count: string;
    }>(`
      select
        to_regprocedure('private.compute_sale_item_component_evidence(uuid,uuid,uuid[],numeric,numeric)') is not null
          as helper_exists,
        has_function_privilege('anon',
          'private.compute_sale_item_component_evidence(uuid,uuid,uuid[],numeric,numeric)', 'EXECUTE')
          as anon_exec,
        has_function_privilege('authenticated',
          'private.compute_sale_item_component_evidence(uuid,uuid,uuid[],numeric,numeric)', 'EXECUTE')
          as authenticated_exec,
        has_function_privilege('service_role',
          'private.compute_sale_item_component_evidence(uuid,uuid,uuid[],numeric,numeric)', 'EXECUTE')
          as service_exec,
        position('compute_sale_item_component_evidence' in
          pg_get_functiondef('private.capture_sale_item_cost_snapshot_trigger()'::regprocedure)) > 0
          as capture_calls_helper,
        position('MISSING_COMPONENT_REFERENCE_COST' in
          pg_get_functiondef('private.capture_sale_item_cost_snapshot_trigger()'::regprocedure)) > 0
          as capture_fail_closed,
        position('theoretical_partial_unit_cost' in
          pg_get_functiondef('private.capture_sale_item_cost_snapshot_trigger()'::regprocedure)) > 0
          as capture_preserves_partial_cost,
        (select count(*)::text
         from pg_trigger t
         join pg_class c on c.oid=t.tgrelid
         join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname='sale_items'
           and t.tgname='trg_capture_sale_item_cost_snapshot'
           and not t.tgisinternal) as capture_trigger_count
    `);
    expect(rows[0]).toMatchObject({
      helper_exists: true, anon_exec: false,
      authenticated_exec: false, service_exec: false,
      capture_calls_helper: true, capture_fail_closed: true,
      capture_preserves_partial_cost: true, capture_trigger_count: '1',
    });
  });

  it('calculates non-vacuous BOM and modifier evidence in an isolated CI transaction', async () => {
    const organizationId = randomUUID();
    const branchId = randomUUID();
    const materialUnitId = randomUUID();
    const pricedRawId = randomUUID();
    const unpricedRawId = randomUUID();
    const productId = randomUUID();
    const groupId = randomUUID();
    const optionId = randomUUID();
    const token = randomUUID().slice(0, 8);

    await client.query('BEGIN');
    try {
      await client.query(
        'insert into public.organizations(id,name,slug) values($1,$2,$3)',
        [organizationId, 'CI Cost Snapshot', `ci-cost-${token}`],
      );
      await client.query(
        'insert into public.branches(id,name,is_active,organization_id) values($1,$2,true,$3)',
        [branchId, 'CI Cost Evidence', organizationId],
      );
      await client.query(
        "insert into public.measurement_units(id,code,name,symbol,is_active) values($1,$2,'CI Cost UOM','u',true)",
        [materialUnitId, `CI-COST-${token}`],
      );
      await client.query(
        `insert into public.raw_materials(id,code,name,unit_id,default_cost,branch_id,is_active)
         values($1,$3,'Priced Ingredient',$5,10,$6,true),
               ($2,$4,'Missing Price Ingredient',$5,0,$6,true)`,
        [pricedRawId, unpricedRawId, `CI-R1-${token}`, `CI-R2-${token}`,
          materialUnitId, branchId],
      );
      // Snapshots and current component evidence use published prices, not the catalog fallback.
      // Explicit transaction time keeps the price visible to the as-of-now snapshot below.
      await client.query(
        `insert into public.raw_material_price_events(raw_material_id,branch_id,unit_cost,reference_number,priced_at)
         values($1,$2,10,$3,now())`,
        [pricedRawId, branchId, `CI-PUBLISHED-${token}`],
      );
      await client.query(
        `insert into public.products(id,name,sku,cost_price,sale_price,wholesale_price,is_active,product_type,branch_id)
         values($1,'CI Manufactured Cost Evidence',$2,0,50,50,true,'manufactured',$3)`,
        [productId, `CI-P-${token}`, branchId],
      );
      const recipe = await client.query<{ id: string }>(
        `insert into public.recipes(product_id,branch_id,name,yield_quantity,is_active)
         values($1,$2,'CI Exact Cost Recipe',1,true) returning id`,
        [productId, branchId],
      );
      await client.query(
        `insert into public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent)
         values($1,$2,2,0),($1,$3,1,0)`,
        [recipe.rows[0].id, pricedRawId, unpricedRawId],
      );
      await client.query(
        "insert into public.product_modifier_groups(id,branch_id,name) values($1,$2,'CI Modifier')",
        [groupId, branchId],
      );
      await client.query(
        "insert into public.product_modifier_group_products(group_id,product_id,branch_id) values($1,$2,$3)",
        [groupId, productId, branchId],
      );
      await client.query(
        "insert into public.product_modifier_options(id,branch_id,group_id,name) values($1,$2,$3,'CI Extra')",
        [optionId, branchId, groupId],
      );
      await client.query(
        `insert into public.product_modifier_inventory_effects
           (branch_id,option_id,target_type,raw_material_id,quantity_delta)
         values($1,$2,'raw_material',$3,1.5)`,
        [branchId, optionId, pricedRawId],
      );

      const { rows } = await client.query<{
        costing: { status: string; theoretical_unit_cost: number;
          base_theoretical_unit_cost: number; modifier_theoretical_unit_delta: number };
        evidence: {
          schema_version: number;
          status: string;
          base_cost_matches: boolean;
          modifier_cost_matches: boolean;
          base_component_unit_cost: number;
          modifier_component_unit_delta: number;
          base_missing_input_count: number;
          base_components: Array<{ source_id: string; quantity_per_sale: number;
            cost_per_unit: number; extended_unit_cost: number; missing_cost_input: boolean }>;
          modifier_effects: Array<{ effect_id: string; option_id: string;
            quantity_delta: number; extended_unit_delta: number }>;
        };
      }>(`
        with reference as (
          select private.compute_sale_item_cost_snapshot($1,$2,array[$3::uuid],1,now()) costing
        )
        select
          r.costing,
          private.compute_sale_item_component_evidence(
            $1,$2,array[$3::uuid],
            (r.costing->>'base_theoretical_unit_cost')::numeric,
            (r.costing->>'modifier_theoretical_unit_delta')::numeric
          ) evidence
        from reference r
      `, [productId, branchId, optionId]);

      const { costing, evidence } = rows[0];
      expect(costing.status).toBe('AVAILABLE');
      expect(Number(costing.base_theoretical_unit_cost)).toBeCloseTo(20, 5);
      expect(Number(costing.modifier_theoretical_unit_delta)).toBeCloseTo(15, 5);
      expect(Number(costing.theoretical_unit_cost)).toBeCloseTo(35, 5);
      expect(evidence.schema_version).toBe(1);
      expect(evidence.status).toBe('MISSING_COMPONENT_REFERENCE_COST');
      expect(evidence.base_cost_matches).toBe(true);
      expect(evidence.modifier_cost_matches).toBe(true);
      expect(evidence.base_components).toHaveLength(2);
      expect(evidence.modifier_effects).toHaveLength(1);
      expect(Number(evidence.base_component_unit_cost)).toBeCloseTo(20, 5);
      expect(Number(evidence.modifier_component_unit_delta)).toBeCloseTo(15, 5);
      expect(evidence.base_missing_input_count).toBe(1);
      expect(evidence.base_components.some((item) =>
        item.source_id && item.missing_cost_input && Number(item.cost_per_unit) === 0,
      )).toBe(true);
      expect(evidence.modifier_effects[0].option_id).toBe(optionId);
      expect(Number(evidence.modifier_effects[0].quantity_delta)).toBeCloseTo(1.5, 5);
      expect(Number(evidence.modifier_effects[0].extended_unit_delta)).toBeCloseTo(15, 5);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('does not backfill pre-capture history with present-day component costs', async () => {
    const { rows } = await client.query<{ legacy_rewritten: string }>(`
      select count(*)::text as legacy_rewritten
      from private.sale_item_cost_snapshots cs
      join private.costing_v2_control ctrl on ctrl.id=true
      where cs.captured_at < ctrl.sale_snapshot_started_at
    `);
    expect(rows[0]?.legacy_rewritten).toBe('0');
  });
});
