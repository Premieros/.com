-- Catalog valuation uses the published price at read time, without rewriting historical sales.
CREATE FUNCTION private.catalog_product_component_cost(p_product_id uuid, p_branch_id uuid, p_is_unit boolean DEFAULT false)
RETURNS numeric
LANGUAGE sql STABLE SET search_path = ''
AS $function$
  WITH RECURSIVE composition(id, is_unit, quantity, path) AS (
    SELECT p_product_id, p_is_unit, 1::numeric, ARRAY[p_product_id]
    UNION ALL
    SELECT child.id, child.is_unit, parent.quantity * child.quantity, parent.path || child.id
    FROM composition parent
    CROSS JOIN LATERAL (
      SELECT u.id, true AS is_unit, l.quantity
      FROM public.product_unit_links l
      JOIN public.inventory_units u ON u.id = l.unit_id
      WHERE NOT parent.is_unit AND l.product_id = parent.id AND u.branch_id = p_branch_id
      UNION ALL
      SELECT u.id, true, r.quantity * (1 + coalesce(r.wastage_percent, 0) / 100.0)
      FROM public.inventory_unit_recipe_units r
      JOIN public.inventory_units u ON u.id = r.component_unit_id
      WHERE parent.is_unit AND r.unit_id = parent.id AND u.branch_id = p_branch_id
      UNION ALL
      SELECT p.id, false, c.quantity
      FROM public.product_components c
      JOIN public.products p ON p.id = c.component_product_id
      WHERE NOT parent.is_unit AND c.product_id = parent.id AND p.branch_id = p_branch_id
    ) child
    WHERE NOT child.id = ANY(parent.path)
  ), ingredients AS (
    SELECT i.raw_material_id,
      c.quantity * i.quantity * (1 + coalesce(i.wastage_percent, 0) / 100.0)
        / nullif(coalesce(r.yield_quantity, 1), 0) AS quantity
    FROM composition c
    JOIN public.recipes r ON NOT c.is_unit AND r.product_id = c.id
      AND r.branch_id = p_branch_id AND r.is_active
    JOIN public.recipe_items i ON i.recipe_id = r.id
    UNION ALL
    SELECT i.raw_material_id, c.quantity * i.quantity * (1 + coalesce(i.wastage_percent, 0) / 100.0)
    FROM composition c
    JOIN public.inventory_unit_recipes i ON c.is_unit AND i.unit_id = c.id
  ), quantities AS (
    SELECT raw_material_id, sum(quantity) AS quantity
    FROM ingredients
    GROUP BY raw_material_id
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM quantities) OR EXISTS (SELECT 1 FROM composition WHERE id <> p_product_id)
    THEN round(coalesce((
      SELECT sum(q.quantity * coalesce((private.raw_published_unit_cost_at_v2(
        q.raw_material_id, p_branch_id, statement_timestamp()
      )->>'unit_cost')::numeric, 0))
      FROM quantities q
    ), 0), 2)
  END;
$function$;

REVOKE ALL ON FUNCTION private.catalog_product_component_cost(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_product_live_costs(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE(product_id uuid, calculated_cost numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR (p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, coalesce(private.catalog_product_component_cost(p.id, p.branch_id), p.cost_price, 0)
  FROM public.products p
  WHERE (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    AND (public.is_pos_admin() OR public.user_may_access_branch(p.branch_id));
END;
$function$;

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
    'unit_cost',COALESCE((private.raw_published_unit_cost_at_v2(rm.id,v_branch,statement_timestamp())->>'unit_cost')::numeric,0),
    'line_cost',round(
      (ri.quantity / NULLIF(COALESCE(r.yield_quantity,1),0))
      * (1 + COALESCE(ri.wastage_percent,0)/100.0)
      * COALESCE((private.raw_published_unit_cost_at_v2(rm.id,v_branch,statement_timestamp())->>'unit_cost')::numeric,0)
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
    'unit_cost',coalesce(private.catalog_product_component_cost(iu.id,v_branch,true),0),
    'line_cost',round(pul.quantity * coalesce(private.catalog_product_component_cost(iu.id,v_branch,true),0),2)
  ) ORDER BY iu.name),'[]'::jsonb)
  INTO v_units
  FROM public.product_unit_links pul
  JOIN public.inventory_units iu ON iu.id=pul.unit_id
  WHERE pul.product_id=p_product_id
    AND iu.branch_id=v_branch;

  WITH RECURSIVE roots AS (
    SELECT pul.unit_id AS root_unit_id, pul.quantity::numeric AS root_qty
    FROM public.product_unit_links pul
    JOIN public.inventory_units iu ON iu.id=pul.unit_id AND iu.branch_id=v_branch
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
    JOIN public.inventory_units child ON child.id=rel.component_unit_id AND child.branch_id=v_branch
    WHERE NOT rel.component_unit_id = ANY(ut.path)
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
      COALESCE((private.raw_published_unit_cost_at_v2(rm.id,v_branch,statement_timestamp())->>'unit_cost')::numeric,0) AS raw_unit_cost
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

  v_total := coalesce(private.catalog_product_component_cost(p_product_id,v_branch),0);

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

NOTIFY pgrst, 'reload schema';
