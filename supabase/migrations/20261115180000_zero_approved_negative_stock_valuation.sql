-- A published zero is a real approved price. Never resurrect stale batch prices
-- while estimating negative stock in Costing Center.
-- Historical positive-stock batch valuation remains unchanged.
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.get_raw_material_cost_valuation_overview(p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(raw_material_id uuid, raw_material_name text, raw_material_code text, branch_id uuid, latest_cost numeric, previous_cost numeric, change_amount numeric, change_pct numeric, price_source text, priced_at timestamp with time zone, reference_number text, source_detail text, event_count bigint, stock_quantity numeric, positive_quantity numeric, negative_quantity numeric, actual_stock_value numeric, estimated_negative_value numeric, unpriced_negative_quantity numeric, estimated_net_stock_value numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT public.can_permission('reports.costing') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF p_branch_id IS NOT NULL
     AND NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  RETURN QUERY
  WITH price_rows AS MATERIALIZED (
    SELECT *
    FROM public.get_raw_material_cost_overview(p_branch_id)
  ),
  batch_values AS MATERIALIZED (
    SELECT
      b.raw_material_id,
      b.branch_id,
      COALESCE(SUM(b.quantity), 0)::numeric AS stock_quantity,
      COALESCE(SUM(b.quantity) FILTER (WHERE b.quantity > 0), 0)::numeric AS positive_quantity,
      COALESCE(-SUM(b.quantity) FILTER (WHERE b.quantity < 0), 0)::numeric AS negative_quantity,
      COALESCE(SUM(b.quantity * COALESCE(b.unit_cost, 0))
        FILTER (WHERE b.quantity > 0), 0)::numeric AS actual_stock_value,
      COALESCE(SUM((-b.quantity) * COALESCE(pr.latest_cost, 0))
        FILTER (WHERE b.quantity < 0), 0)::numeric AS estimated_negative_value,
      COALESCE(SUM((-b.quantity))
        FILTER (
          WHERE b.quantity < 0
            AND pr.price_source = 'no_published_price'
        ), 0)::numeric AS unpriced_negative_quantity
    FROM public.raw_material_batches b
    JOIN price_rows pr
      ON pr.raw_material_id = b.raw_material_id
     AND pr.branch_id = b.branch_id
    GROUP BY b.raw_material_id, b.branch_id
  )
  SELECT
    pr.raw_material_id,
    pr.raw_material_name,
    pr.raw_material_code,
    pr.branch_id,
    pr.latest_cost,
    pr.previous_cost,
    pr.change_amount,
    pr.change_pct,
    pr.price_source,
    pr.priced_at,
    pr.reference_number,
    pr.source_detail,
    pr.event_count,
    COALESCE(bv.stock_quantity, 0)::numeric,
    COALESCE(bv.positive_quantity, 0)::numeric,
    COALESCE(bv.negative_quantity, 0)::numeric,
    round(COALESCE(bv.actual_stock_value, 0), 2)::numeric,
    round(COALESCE(bv.estimated_negative_value, 0), 2)::numeric,
    round(COALESCE(bv.unpriced_negative_quantity, 0), 6)::numeric,
    round(
      COALESCE(bv.actual_stock_value, 0)
      - COALESCE(bv.estimated_negative_value, 0),
      2
    )::numeric
  FROM price_rows pr
  LEFT JOIN batch_values bv
    ON bv.raw_material_id = pr.raw_material_id
   AND bv.branch_id = pr.branch_id
  ORDER BY pr.raw_material_name;
END;
$function$;
