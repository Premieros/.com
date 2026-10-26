-- Current operational valuation uses signed unified stock and published current catalog cost; historical ledger amounts remain unchanged.
CREATE OR REPLACE FUNCTION public.get_stock_valuation(p_branch_id uuid DEFAULT NULL::uuid, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(product_id uuid, product_name text, barcode text, sku text, warehouse_id uuid, warehouse_name text, branch_id uuid, quantity numeric, unit_cost numeric, total_value numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_branch uuid;
  v_scope uuid;
BEGIN
  IF NOT is_pos_admin() THEN
    SELECT u.branch_id INTO v_user_branch FROM public.users u WHERE u.id = auth.uid();
    v_scope := v_user_branch;
  ELSE
    v_scope := p_branch_id;
  END IF;

  RETURN QUERY
  WITH val AS (
    SELECT b.item_id AS product_id,b.warehouse_id,b.branch_id,
      b.quantity::numeric(14,4) AS quantity,
      COALESCE(c.unit_cost,0)::numeric(12,2) AS unit_cost
    FROM public.v_stock_balances_unified b
    JOIN public.v_stock_current_costs c ON c.item_type=b.item_type
      AND c.item_id=b.item_id AND c.branch_id=b.branch_id
    WHERE b.item_type='product'
      AND (v_scope IS NULL OR b.branch_id=v_scope)
      AND (p_warehouse_id IS NULL OR b.warehouse_id=p_warehouse_id)
  )
  SELECT
    v.product_id,
    COALESCE(NULLIF(btrim(p.name), ''), 'Product') AS product_name,
    p.barcode,
    p.sku,
    v.warehouse_id,
    w.name AS warehouse_name,
    v.branch_id,
    v.quantity,
    v.unit_cost,
    round(v.quantity * v.unit_cost, 2)::numeric(16,2) AS total_value
  FROM val v
  JOIN public.products p ON p.id = v.product_id
  LEFT JOIN public.warehouses w ON w.id = v.warehouse_id
  ORDER BY v.branch_id ASC, p.name ASC;
END;
$function$
;
