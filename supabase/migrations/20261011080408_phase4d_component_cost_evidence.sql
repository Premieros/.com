-- Phase 4D acceptance hardening: line-level historical component evidence.
-- Additive only: no historical backfill; no FIFO, sale pricing or journal changes.
-- "basis" is already immutable to API roles and stays in the private snapshot table.
create or replace function private.compute_sale_item_component_evidence(
  p_product_id uuid,
  p_branch_id uuid,
  p_modifier_option_ids uuid[],
  p_expected_base_unit_cost numeric,
  p_expected_modifier_delta numeric
) returns jsonb
language plpgsql
stable security definer
set search_path=public,pg_temp
as $component$
declare
  v_product_type text;
  v_base_lines jsonb := '[]'::jsonb;
  v_mod_lines jsonb := '[]'::jsonb;
  v_base_subtotal numeric := 0;
  v_mod_subtotal numeric := 0;
  v_base_zero_count integer := 0;
  v_modifier_missing_count integer := 0;
  v_base_matches boolean;
  v_mod_matches boolean;
begin
  select p.product_type into v_product_type
  from public.products p
  where p.id=p_product_id and p.branch_id=p_branch_id;

  -- These are the same contribution formulas used by _product_recipe_cost:
  -- all active product recipes plus active linked inventory units.
  with lines as (
    select 'RECIPE_RAW'::text source_type,
           ri.id source_id, ri.raw_material_id component_id,
           r.id recipe_id, r.version recipe_version,
           (ri.quantity/nullif(coalesce(r.yield_quantity,1),0))
           *(1+coalesce(ri.wastage_percent,0)/100.0) quantity_per_sale,
           public._raw_cost_for_costing(ri.raw_material_id,p_branch_id) cost_per_unit
    from public.recipe_items ri
    join public.recipes r on r.id=ri.recipe_id
    where r.product_id=p_product_id
      and r.is_active=true
      and r.branch_id=p_branch_id
    union all
    select 'LINKED_INVENTORY_UNIT'::text, pul.id, pul.unit_id,
           null::uuid, null::integer, pul.quantity,
           public._inventory_unit_recipe_cost(pul.unit_id,p_branch_id)
    from public.product_unit_links pul
    join public.inventory_units iu on iu.id=pul.unit_id
    where pul.product_id=p_product_id
      and iu.branch_id=p_branch_id
      and iu.is_active=true
  ), enriched as (
    select *,
      quantity_per_sale*cost_per_unit as extended_unit_cost,
      (quantity_per_sale is null or cost_per_unit is null
       or (quantity_per_sale<>0 and cost_per_unit<=0)) as missing_cost_input
    from lines
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'source_type',source_type,'source_id',source_id,
      'component_id',component_id,'recipe_id',recipe_id,
      'recipe_version',recipe_version,'quantity_per_sale',quantity_per_sale,
      'cost_per_unit',cost_per_unit,'extended_unit_cost',extended_unit_cost,
      'missing_cost_input',missing_cost_input
    ) order by source_type,source_id),'[]'::jsonb),
    coalesce(sum(extended_unit_cost),0),
    count(*) filter (where missing_cost_input)
  into v_base_lines,v_base_subtotal,v_base_zero_count
  from enriched;

  -- Each real modifier inventory effect is preserved separately;
  -- keep the established resolver's exact target-cost choices and delta formula.
  with effects as (
    select e.id effect_id,e.option_id,e.target_type,e.raw_material_id,
           e.inventory_unit_id,e.quantity_delta,
           case
             when e.target_type='raw_material' and e.raw_material_id is not null
               then public._raw_cost_for_costing(e.raw_material_id,p_branch_id)
             when e.target_type='inventory_unit' and e.inventory_unit_id is not null
               then public._inventory_unit_recipe_cost(e.inventory_unit_id,p_branch_id)
             else null::numeric
           end cost_per_unit
    from public.product_modifier_inventory_effects e
    where e.branch_id=p_branch_id
      and e.option_id=any(coalesce(p_modifier_option_ids,'{}'::uuid[]))
  ), enriched as (
    select *,
       quantity_delta*coalesce(cost_per_unit,0) as extended_unit_delta,
       (cost_per_unit is null or
        (cost_per_unit<=0 and quantity_delta<>0)) as missing_cost_input
    from effects
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'effect_id',effect_id,'option_id',option_id,
      'target_type',target_type,'raw_material_id',raw_material_id,
      'inventory_unit_id',inventory_unit_id,'quantity_delta',quantity_delta,
      'cost_per_unit',cost_per_unit,'extended_unit_delta',extended_unit_delta,
      'missing_cost_input',missing_cost_input
    ) order by effect_id),'[]'::jsonb),
    coalesce(sum(extended_unit_delta),0),
    count(*) filter (where missing_cost_input)
  into v_mod_lines,v_mod_subtotal,v_modifier_missing_count
  from enriched;

  v_base_matches := case
    when v_product_type='manufactured'
      then round(v_base_subtotal,2) is not distinct from p_expected_base_unit_cost
    else null
  end;
  v_mod_matches := v_mod_subtotal is not distinct from p_expected_modifier_delta;

  return jsonb_build_object(
    'schema_version',1,
    'status',case
      when v_mod_matches is distinct from true
        or v_base_matches is false then 'COST_MISMATCH'
      when v_product_type='manufactured' and v_base_zero_count>0
        then 'MISSING_COMPONENT_REFERENCE_COST'
      when v_modifier_missing_count>0 then 'MISSING_MODIFIER_REFERENCE_COST'
      when v_product_type<>'manufactured' then 'STORED_PRODUCT_REFERENCE'
      else 'RECONCILED'
    end,
    'cost_basis',case when v_product_type='manufactured'
       then 'ALL_ACTIVE_RECIPE_LINES_AND_LINKED_UNIT_COSTS'
       else 'STORED_PRODUCT_REFERENCE' end,
    'base_components',v_base_lines,
    'modifier_effects',v_mod_lines,
    'base_component_unit_cost',round(v_base_subtotal,2),
    'base_cost_matches',v_base_matches,
    'modifier_component_unit_delta',v_mod_subtotal,
    'modifier_cost_matches',v_mod_matches,
    'base_missing_input_count',v_base_zero_count,
    'modifier_missing_input_count',v_modifier_missing_count
  );
end;
$component$;

revoke execute on function private.compute_sale_item_component_evidence(uuid,uuid,uuid[],numeric,numeric)
  from public,anon,authenticated,service_role;
grant execute on function private.compute_sale_item_component_evidence(uuid,uuid,uuid[],numeric,numeric)
  to postgres;

create or replace function private.capture_sale_item_cost_snapshot_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_branch_id uuid;
  v_capture_at timestamptz:=coalesce(new.created_at,clock_timestamp());
  v_snapshot jsonb;
begin
  if new.product_id is null or coalesce(new.quantity,0)<=0 then
    return new;
  end if;

  select s.branch_id
  into v_branch_id
  from public.sales s
  where s.id=new.sale_id;

  if v_branch_id is null then
    return new;
  end if;

  v_snapshot:=private.compute_sale_item_cost_snapshot(
    new.product_id,
    v_branch_id,
    coalesce(new.modifier_option_ids,'{}'::uuid[]),
    new.quantity,
    v_capture_at
  );
  -- Evidence augments (never recalculates) the established immutable cost.
  -- A detail-capture fault must not alter the existing successful sale snapshot.
  begin
    v_snapshot := v_snapshot || jsonb_build_object(
      'component_cost_evidence',
      private.compute_sale_item_component_evidence(
        new.product_id, v_branch_id,
        coalesce(new.modifier_option_ids,'{}'::uuid[]),
        nullif(v_snapshot->>'base_theoretical_unit_cost','')::numeric,
        coalesce((v_snapshot->>'modifier_theoretical_unit_delta')::numeric,0)
      )
    );
  exception when others then
    v_snapshot := v_snapshot || jsonb_build_object(
      'component_cost_evidence',
      jsonb_build_object('status','CAPTURE_ERROR','schema_version',1)
    );
  end;

  insert into private.sale_item_cost_snapshots(
    sale_item_id,sale_id,branch_id,product_id,sale_quantity,
    theoretical_unit_cost,theoretical_total_cost,
    standard_unit_cost,standard_total_cost,theoretical_status,
    recipe_id,recipe_version,modifier_theoretical_unit_delta,
    modifier_effect_count,missing_modifier_cost_count,
    selected_modifier_option_ids,costing_model_version,basis,captured_at
  )
  values(
    new.id,new.sale_id,v_branch_id,new.product_id,new.quantity,
    nullif(v_snapshot->>'theoretical_unit_cost','')::numeric,
    nullif(v_snapshot->>'theoretical_total_cost','')::numeric,
    nullif(v_snapshot->>'standard_unit_cost','')::numeric,
    nullif(v_snapshot->>'standard_total_cost','')::numeric,
    coalesce(v_snapshot->>'status','MISSING_INPUT'),
    nullif(v_snapshot->>'recipe_id','')::uuid,
    nullif(v_snapshot->>'recipe_version','')::integer,
    coalesce((v_snapshot->>'modifier_theoretical_unit_delta')::numeric,0),
    coalesce((v_snapshot->>'modifier_effect_count')::integer,0),
    coalesce((v_snapshot->>'missing_modifier_cost_count')::integer,0),
    coalesce(new.modifier_option_ids,'{}'::uuid[]),
    1,v_snapshot,v_capture_at
  )
  on conflict(sale_item_id) do nothing;

  delete from private.sale_item_cost_snapshot_failures
  where sale_item_id=new.id;

  return new;
exception
  when others then
    begin
      insert into private.sale_item_cost_snapshot_failures(
        sale_item_id,sale_id,branch_id,product_id,error_message,attempted_at
      )
      values(
        new.id,new.sale_id,v_branch_id,new.product_id,sqlerrm,clock_timestamp()
      )
      on conflict(sale_item_id) do update
      set sale_id=excluded.sale_id,
          branch_id=excluded.branch_id,
          product_id=excluded.product_id,
          error_message=excluded.error_message,
          attempted_at=excluded.attempted_at;
    exception
      when others then null;
    end;
    return new;
end;
$$;
