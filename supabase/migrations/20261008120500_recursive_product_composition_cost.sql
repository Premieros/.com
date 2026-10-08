-- Live manufactured product composition + recursive component-group costing.
-- Keeps products.cost_price as a stored/manual field; manufactured UI reads live calculated cost.

CREATE OR REPLACE FUNCTION public._inventory_unit_recipe_cost(
  p_unit_id uuid,
  p_branch_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH RECURSIVE unit_tree AS (
    SELECT
      iu.id AS unit_id,
      1::numeric AS factor,
      ARRAY[iu.id]::uuid[] AS path,
      0 AS depth
    FROM public.inventory_units iu
    WHERE iu.id = p_unit_id
      AND (p_branch_id IS NULL OR iu.branch_id = p_branch_id)

    UNION ALL

    SELECT
      rel.component_unit_id,
      ut.factor * rel.quantity * (1 + COALESCE(rel.wastage_percent,0) / 100.0),
      ut.path || rel.component_unit_id,
      ut.depth + 1
    FROM unit_tree ut
    JOIN public.inventory_unit_recipe_units rel ON rel.unit_id = ut.unit_id
    JOIN public.inventory_units child ON child.id = rel.component_unit_id
    WHERE (p_branch_id IS NULL OR child.branch_id = p_branch_id)
      AND NOT rel.component_unit_id = ANY(ut.path)
      AND ut.depth < 15
  ),
  raw_lines AS (
    SELECT
      iur.raw_material_id,
      ut.factor * iur.quantity * (1 + COALESCE(iur.wastage_percent,0) / 100.0) AS qty
    FROM unit_tree ut
    JOIN public.inventory_unit_recipes iur ON iur.unit_id = ut.unit_id
  ),
  recursive_cost AS (
    SELECT COALESCE(SUM(rl.qty * COALESCE(public._raw_cost_for_costing(rl.raw_material_id,p_branch_id),0)),0)::numeric AS cost
    FROM raw_lines rl
  )
  SELECT round(
    CASE
      WHEN rc.cost > 0 THEN rc.cost
      ELSE COALESCE((SELECT iu.cost_price FROM public.inventory_units iu WHERE iu.id=p_unit_id),0)
    END
  ,2)
  FROM recursive_cost rc
$function$;

REVOKE ALL ON FUNCTION public._inventory_unit_recipe_cost(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._inventory_unit_recipe_cost(uuid,uuid) TO service_role, postgres;


CREATE OR REPLACE FUNCTION public._product_recipe_cost(
  p_product_id uuid,
  p_branch_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH direct_cost AS (
    SELECT COALESCE(SUM(
      (ri.quantity / NULLIF(COALESCE(r.yield_quantity,1),0))
      * (1 + COALESCE(ri.wastage_percent,0) / 100.0)
      * COALESCE(public._raw_cost_for_costing(ri.raw_material_id,p_branch_id),0)
    ),0)::numeric AS cost
    FROM public.recipe_items ri
    JOIN public.recipes r ON r.id=ri.recipe_id
    WHERE r.product_id=p_product_id
      AND r.is_active=true
      AND (p_branch_id IS NULL OR r.branch_id=p_branch_id)
  ),
  unit_cost AS (
    SELECT COALESCE(SUM(
      pul.quantity * public._inventory_unit_recipe_cost(pul.unit_id,p_branch_id)
    ),0)::numeric AS cost
    FROM public.product_unit_links pul
    JOIN public.inventory_units iu ON iu.id=pul.unit_id
    WHERE pul.product_id=p_product_id
      AND iu.is_active=true
      AND (p_branch_id IS NULL OR iu.branch_id=p_branch_id)
  )
  SELECT round(dc.cost + uc.cost,2)
  FROM direct_cost dc CROSS JOIN unit_cost uc
$function$;

REVOKE ALL ON FUNCTION public._product_recipe_cost(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._product_recipe_cost(uuid,uuid) TO service_role, postgres;


CREATE OR REPLACE FUNCTION public.get_product_operational_composition(
  p_product_id uuid,
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch uuid;
  v_direct jsonb;
  v_units jsonb;
  v_expanded jsonb;
  v_total numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;

  SELECT p.branch_id INTO v_branch
  FROM public.products p
  WHERE p.id=p_product_id;

  IF v_branch IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','PRODUCT_NOT_FOUND');
  END IF;
  IF p_branch_id IS NOT NULL AND p_branch_id IS DISTINCT FROM v_branch THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF NOT public.user_may_access_branch(v_branch) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_ACCESS_DENIED');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'raw_material_id',rm.id,
    'raw_material_name',rm.name,
    'quantity_per_sale_unit',ri.quantity / NULLIF(COALESCE(r.yield_quantity,1),0),
    'wastage_percent',ri.wastage_percent,
    'unit_cost',COALESCE(public._raw_cost_for_costing(rm.id,v_branch),0),
    'line_cost',round(
      (ri.quantity / NULLIF(COALESCE(r.yield_quantity,1),0))
      * (1 + COALESCE(ri.wastage_percent,0)/100.0)
      * COALESCE(public._raw_cost_for_costing(rm.id,v_branch),0)
    ,2)
  ) ORDER BY rm.name),'[]'::jsonb)
  INTO v_direct
  FROM public.recipes r
  JOIN public.recipe_items ri ON ri.recipe_id=r.id
  JOIN public.raw_materials rm ON rm.id=ri.raw_material_id
  WHERE r.product_id=p_product_id AND r.branch_id=v_branch AND r.is_active=true;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'unit_id',iu.id,
    'unit_name',iu.name,
    'quantity',pul.quantity,
    'unit_cost',public._inventory_unit_recipe_cost(iu.id,v_branch),
    'line_cost',round(pul.quantity * public._inventory_unit_recipe_cost(iu.id,v_branch),2)
  ) ORDER BY iu.name),'[]'::jsonb)
  INTO v_units
  FROM public.product_unit_links pul
  JOIN public.inventory_units iu ON iu.id=pul.unit_id
  WHERE pul.product_id=p_product_id
    AND iu.is_active=true
    AND iu.branch_id=v_branch;

  WITH RECURSIVE roots AS (
    SELECT pul.unit_id AS root_unit_id, pul.quantity::numeric AS root_qty
    FROM public.product_unit_links pul
    WHERE pul.product_id=p_product_id
  ),
  unit_tree AS (
    SELECT
      r.root_unit_id,
      r.root_unit_id AS unit_id,
      r.root_qty AS factor,
      ARRAY[r.root_unit_id]::uuid[] AS path,
      0 AS depth
    FROM roots r
    UNION ALL
    SELECT
      ut.root_unit_id,
      rel.component_unit_id,
      ut.factor * rel.quantity * (1 + COALESCE(rel.wastage_percent,0)/100.0),
      ut.path || rel.component_unit_id,
      ut.depth + 1
    FROM unit_tree ut
    JOIN public.inventory_unit_recipe_units rel ON rel.unit_id=ut.unit_id
    WHERE NOT rel.component_unit_id = ANY(ut.path)
      AND ut.depth < 15
  ),
  rows AS (
    SELECT
      ut.root_unit_id,
      ut.unit_id,
      iu.name AS unit_name,
      ut.depth,
      rm.id AS raw_material_id,
      rm.name AS raw_material_name,
      ut.factor * iur.quantity * (1 + COALESCE(iur.wastage_percent,0)/100.0) AS effective_quantity,
      COALESCE(public._raw_cost_for_costing(rm.id,v_branch),0) AS raw_unit_cost
    FROM unit_tree ut
    JOIN public.inventory_units iu ON iu.id=ut.unit_id
    JOIN public.inventory_unit_recipes iur ON iur.unit_id=ut.unit_id
    JOIN public.raw_materials rm ON rm.id=iur.raw_material_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'root_unit_id',rows.root_unit_id,
    'unit_id',rows.unit_id,
    'unit_name',rows.unit_name,
    'depth',rows.depth,
    'raw_material_id',rows.raw_material_id,
    'raw_material_name',rows.raw_material_name,
    'effective_quantity',rows.effective_quantity,
    'raw_unit_cost',rows.raw_unit_cost,
    'line_cost',round(rows.effective_quantity*rows.raw_unit_cost,2)
  ) ORDER BY rows.root_unit_id,rows.depth,rows.unit_name,rows.raw_material_name),'[]'::jsonb)
  INTO v_expanded
  FROM rows;

  v_total := public._product_recipe_cost(p_product_id,v_branch);

  RETURN jsonb_build_object(
    'success',true,
    'product_id',p_product_id,
    'branch_id',v_branch,
    'calculated_cost',v_total,
    'direct_raw_materials',COALESCE(v_direct,'[]'::jsonb),
    'linked_units',COALESCE(v_units,'[]'::jsonb),
    'expanded_unit_raw_materials',COALESCE(v_expanded,'[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_product_operational_composition(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_operational_composition(uuid,uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.get_product_live_costs(
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(product_id uuid, calculated_cost numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    CASE
      WHEN p.product_type='manufactured' THEN public._product_recipe_cost(p.id,p.branch_id)
      ELSE COALESCE(p.cost_price,0)
    END::numeric AS calculated_cost
  FROM public.products p
  WHERE p.is_active=true
    AND (p_branch_id IS NULL OR p.branch_id=p_branch_id)
    AND (public.is_pos_admin() OR public.user_may_access_branch(p.branch_id));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_product_live_costs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_live_costs(uuid) TO authenticated, service_role;

NOTIFY pgrst,'reload schema';
