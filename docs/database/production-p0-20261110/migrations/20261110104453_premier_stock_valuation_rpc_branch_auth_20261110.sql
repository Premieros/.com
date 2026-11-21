-- Premier-only server-side valuation authorization. This report uses current
-- catalog unit cost; it MUST NOT alter historical batch COGS or posted journals.
-- Guard the function body before replacement to fail on unexpected source drift.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
DO $guard$
DECLARE v_definition text;
BEGIN
  IF to_regprocedure('public.get_stock_valuation(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREMIER_STOCK_VALUATION_BASELINE_MISSING';
  END IF;
  SELECT pg_get_functiondef('public.get_stock_valuation(uuid,uuid)'::regprocedure)
    INTO v_definition;
  IF v_definition NOT LIKE '%v_scope := v_user_branch%'
     OR v_definition NOT LIKE '%v_scope := p_branch_id%'
     OR v_definition NOT LIKE '%v_stock_balances_unified%'
     OR v_definition NOT LIKE '%v_stock_current_costs%'
  THEN
    RAISE EXCEPTION 'PREMIER_STOCK_VALUATION_BASELINE_DRIFT';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.get_stock_valuation(
  p_branch_id uuid DEFAULT NULL::uuid,
  p_warehouse_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  product_id uuid, product_name text, barcode text, sku text,
  warehouse_id uuid, warehouse_name text, branch_id uuid,
  quantity numeric, unit_cost numeric, total_value numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Never interpret absent user/branch as an unrestricted cross-tenant scope.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'STOCK_VALUATION_AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'STOCK_VALUATION_BRANCH_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF NOT public.can_permission('inventory.view') THEN
    RAISE EXCEPTION 'STOCK_VALUATION_PERMISSION_DENIED' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'STOCK_VALUATION_BRANCH_DENIED' USING ERRCODE = '42501';
  END IF;
  IF p_warehouse_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.warehouses wh
       WHERE wh.id = p_warehouse_id AND wh.branch_id = p_branch_id
     )
  THEN
    RAISE EXCEPTION 'STOCK_VALUATION_WAREHOUSE_BRANCH_MISMATCH'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH val AS (
    SELECT b.item_id AS product_id, b.warehouse_id, b.branch_id,
      b.quantity::numeric(14,4) AS quantity,
      COALESCE(c.unit_cost,0)::numeric(12,2) AS unit_cost
    FROM public.v_stock_balances_unified b
    JOIN public.v_stock_current_costs c
      ON c.item_type=b.item_type AND c.item_id=b.item_id AND c.branch_id=b.branch_id
    WHERE b.item_type='product'
      AND b.branch_id=p_branch_id
      AND (p_warehouse_id IS NULL OR b.warehouse_id=p_warehouse_id)
  )
  SELECT
    v.product_id,
    COALESCE(NULLIF(btrim(p.name),''),'Product') AS product_name,
    p.barcode, p.sku, v.warehouse_id, w.name AS warehouse_name,
    v.branch_id, v.quantity, v.unit_cost,
    round(v.quantity*v.unit_cost,2)::numeric(16,2) AS total_value
  FROM val v
  JOIN public.products p ON p.id=v.product_id AND p.branch_id=v.branch_id
  LEFT JOIN public.warehouses w ON w.id=v.warehouse_id AND w.branch_id=v.branch_id
  ORDER BY v.branch_id ASC, p.name ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_stock_valuation(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stock_valuation(uuid,uuid)
  TO authenticated, service_role;

DO $verify$
DECLARE v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.get_stock_valuation(uuid,uuid)'::regprocedure)
    INTO v_definition;
  IF v_definition NOT LIKE '%STOCK_VALUATION_AUTH_REQUIRED%'
     OR v_definition NOT LIKE '%STOCK_VALUATION_BRANCH_REQUIRED%'
     OR v_definition NOT LIKE '%STOCK_VALUATION_PERMISSION_DENIED%'
     OR v_definition NOT LIKE '%user_may_access_branch(p_branch_id)%'
     OR v_definition NOT LIKE '%b.branch_id=p_branch_id%'
     OR has_function_privilege('anon','public.get_stock_valuation(uuid,uuid)','EXECUTE')
  THEN
    RAISE EXCEPTION 'PREMIER_STOCK_VALUATION_AUTH_POSTCHECK_FAILED';
  END IF;
END;
$verify$;
COMMIT;
