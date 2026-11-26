-- Catalog valuation uses the published price at read time, without rewriting historical sales.
CREATE FUNCTION private.catalog_product_component_cost(p_product_id uuid, p_branch_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SET search_path = ''
AS $function$
  WITH RECURSIVE composition(id, is_unit, quantity, path) AS (
    SELECT p_product_id, false, 1::numeric, ARRAY[p_product_id]
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
  ), legacy_leaf_cost AS (
    SELECT sum(c.quantity * p.cost_price) AS cost
    FROM composition c
    JOIN public.products p ON NOT c.is_unit AND p.id = c.id
    WHERE c.id <> p_product_id
      AND NOT EXISTS (SELECT 1 FROM public.product_components l WHERE l.product_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.product_unit_links l WHERE l.product_id = c.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.recipes r JOIN public.recipe_items i ON i.recipe_id = r.id
        WHERE r.product_id = c.id AND r.branch_id = p_branch_id AND r.is_active
      )
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM quantities) OR EXISTS (SELECT 1 FROM composition WHERE id <> p_product_id)
    THEN round(coalesce((
      SELECT sum(q.quantity * coalesce((private.raw_published_unit_cost_at_v2(
        q.raw_material_id, p_branch_id, statement_timestamp()
      )->>'unit_cost')::numeric, 0))
      FROM quantities q
    ), 0) + coalesce((SELECT cost FROM legacy_leaf_cost), 0), 2)
  END;
$function$;

REVOKE ALL ON FUNCTION private.catalog_product_component_cost(uuid, uuid) FROM PUBLIC, anon, authenticated;

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
