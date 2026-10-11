import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

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
      capture_calls_helper: true, capture_trigger_count: '1',
    });
  });

  it('freezes individual recipe and real modifier contributions with reconciled totals', async () => {
    // Deliberately read-only; never create a sale or guess historical ingredient costs.
    const { rows } = await client.query<{
      base_cost: string | null;
      modifier_delta: string;
      evidence: {
        schema_version: number;
        status: string;
        base_cost_matches: boolean | null;
        modifier_cost_matches: boolean;
        base_component_unit_cost: number;
        modifier_component_unit_delta: number;
        base_components: Array<{
          component_id: string;
          quantity_per_sale: number;
          cost_per_unit: number;
          extended_unit_cost: number;
          missing_cost_input: boolean;
        }>;
        modifier_effects: Array<{
          effect_id: string;
          option_id: string;
          extended_unit_delta: number;
        }>;
        base_missing_input_count: number;
      };
    }>(`
      with sample as (
        select p.id product_id,p.branch_id,e.option_id
        from public.product_modifier_inventory_effects e
        join public.product_modifier_options o on o.id=e.option_id
        join public.product_modifier_groups g on g.id=o.group_id
        join public.products p on p.id=g.product_id and p.branch_id=e.branch_id
        where p.product_type='manufactured'
        order by p.id,e.option_id
        limit 1
      ), reference as (
        select s.*,private.compute_sale_item_cost_snapshot(
          s.product_id,s.branch_id,array[s.option_id],1,clock_timestamp()
        ) costing from sample s
      )
      select
        r.costing->>'base_theoretical_unit_cost' base_cost,
        r.costing->>'modifier_theoretical_unit_delta' modifier_delta,
        private.compute_sale_item_component_evidence(
          r.product_id,r.branch_id,array[r.option_id],
          (r.costing->>'base_theoretical_unit_cost')::numeric,
          (r.costing->>'modifier_theoretical_unit_delta')::numeric
        ) evidence
      from reference r
    `);

    // Empty fresh environments have no real product/modifier fixtures to price.
    if (rows.length === 0) return;

    const { evidence, base_cost, modifier_delta } = rows[0];
    expect(evidence.schema_version).toBe(1);
    expect(evidence.base_cost_matches).toBe(true);
    expect(evidence.modifier_cost_matches).toBe(true);
    expect(evidence.base_components.length).toBeGreaterThan(0);
    expect(evidence.modifier_effects.length).toBeGreaterThan(0);
    expect(Number(evidence.base_component_unit_cost)).toBeCloseTo(Number(base_cost), 2);
    expect(Number(evidence.modifier_component_unit_delta)).toBeCloseTo(Number(modifier_delta), 5);
    expect(['RECONCILED', 'MISSING_COMPONENT_REFERENCE_COST',
      'MISSING_MODIFIER_REFERENCE_COST']).toContain(evidence.status);
    expect(evidence.base_components.every((line) =>
      Boolean(line.component_id) && line.quantity_per_sale !== null,
    )).toBe(true);
    expect(evidence.modifier_effects.every((effect) =>
      Boolean(effect.effect_id) && Boolean(effect.option_id),
    )).toBe(true);
    expect(evidence.base_missing_input_count).toBeGreaterThanOrEqual(0);
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
