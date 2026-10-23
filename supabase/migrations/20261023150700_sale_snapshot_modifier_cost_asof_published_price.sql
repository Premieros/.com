-- Sale modifier published price as of sale timestamp; zero allowed for existing recipe.
CREATE OR REPLACE FUNCTION private.compute_sale_item_cost_snapshot(p_product_id uuid, p_branch_id uuid, p_modifier_option_ids uuid[], p_sale_quantity numeric, p_captured_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item_id uuid;
  v_base_cost numeric;
  v_base_status text;
  v_modifier_delta numeric := 0;
  v_modifier_effect_count integer := 0;
  v_missing_modifier_cost_count integer := 0;
  v_recipe_id uuid;
  v_recipe_version integer;
  v_standard_cost numeric;
  v_theoretical_unit numeric;
  v_theoretical_total numeric;
  v_effective_options uuid[] := coalesce(p_modifier_option_ids,'{}'::uuid[]);
begin
  if p_product_id is null
     or p_branch_id is null
     or p_sale_quantity is null
     or p_sale_quantity<=0 then
    return jsonb_build_object('status','MISSING_INPUT','reason','INVALID_INPUT');
  end if;

  select
    l.item_id,
    c.theoretical_cost,
    c.theoretical_cost_status
  into
    v_item_id,
    v_base_cost,
    v_base_status
  from private.item_legacy_links l
  join private.canonical_item_costs c
    on c.item_id=l.item_id
   and c.branch_id=p_branch_id
  where l.source_table='products'
    and l.source_id=p_product_id
  limit 1;

  select r.id,r.version
  into v_recipe_id,v_recipe_version
  from public.recipes r
  where r.product_id=p_product_id
    and r.branch_id=p_branch_id
    and coalesce(r.is_active,true)=true
  order by coalesce(r.version,1) desc,r.created_at desc
  limit 1;

  with modifier_effects as (
    select
      e.id,
      e.quantity_delta,
      case
        when e.target_type='raw_material' and e.raw_material_id is not null
          then (private.raw_published_unit_cost_at_v2(e.raw_material_id,p_branch_id,p_captured_at)->>'unit_cost')::numeric
        when e.target_type='inventory_unit' and e.inventory_unit_id is not null
          then public._inventory_unit_recipe_cost(e.inventory_unit_id,p_branch_id)
        else null::numeric
      end as target_unit_cost
    from public.product_modifier_inventory_effects e
    where e.branch_id=p_branch_id
      and e.option_id=any(v_effective_options)
  )
  select
    count(*)::integer,
    count(*) filter(
      where target_unit_cost is null
    )::integer,
    coalesce(sum(quantity_delta*coalesce(target_unit_cost,0)),0)::numeric
  into
    v_modifier_effect_count,
    v_missing_modifier_cost_count,
    v_modifier_delta
  from modifier_effects;

  select s.standard_cost
  into v_standard_cost
  from public.item_standard_costs s
  where s.item_id=v_item_id
    and s.branch_id=p_branch_id
    and s.effective_from<=p_captured_at
    and (s.effective_to is null or s.effective_to>p_captured_at)
  order by s.effective_from desc
  limit 1;

  if ( (coalesce(v_base_status,'MISSING_INPUT')='AVAILABLE' and v_base_cost is not null)
       or (v_recipe_id is not null and v_base_cost=0) )
     and v_missing_modifier_cost_count=0 then
    v_theoretical_unit:=greatest(v_base_cost+v_modifier_delta,0);
    v_theoretical_total:=v_theoretical_unit*p_sale_quantity;
  else
    v_theoretical_unit:=null;
    v_theoretical_total:=null;
  end if;

  return jsonb_build_object(
    'status',case when v_theoretical_unit is not null then 'AVAILABLE' else 'MISSING_INPUT' end,
    'item_id',v_item_id,
    'base_theoretical_unit_cost',v_base_cost,
    'modifier_theoretical_unit_delta',coalesce(v_modifier_delta,0),
    'modifier_effect_count',coalesce(v_modifier_effect_count,0),
    'missing_modifier_cost_count',coalesce(v_missing_modifier_cost_count,0),
    'theoretical_unit_cost',v_theoretical_unit,
    'theoretical_total_cost',v_theoretical_total,
    'standard_unit_cost',v_standard_cost,
    'standard_total_cost',case
      when v_standard_cost is null then null
      else v_standard_cost*p_sale_quantity
    end,
    'recipe_id',v_recipe_id,
    'recipe_version',v_recipe_version,
    'selected_modifier_option_ids',to_jsonb(v_effective_options)
  );
end;
$function$
