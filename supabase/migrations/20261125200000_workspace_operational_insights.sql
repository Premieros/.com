-- Bounded branch read models for the workspace. Existing table RLS stays in effect.
CREATE FUNCTION public.get_workspace_order_hours(p_branch uuid, p_days integer)
RETURNS TABLE(weekday integer, hour integer, order_type text, channel text, orders bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  cairo_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
  IF auth.uid() IS NULL OR p_branch IS NULL OR NOT COALESCE(public.user_may_access_branch(p_branch), false)
     OR NOT COALESCE(public.can_permission('reports.view'), false)
     OR NOT COALESCE(public.can_permission('pos.view'), false)
     OR p_days IS NULL OR p_days NOT IN (7, 30)
     OR (p_days = 30 AND NOT COALESCE(public.can_permission('history.unlimited'), false)) THEN
    RAISE EXCEPTION 'WORKSPACE_ORDER_HOURS_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT extract(isodow FROM timing.local_time)::integer,
         extract(hour FROM timing.local_time)::integer,
         o.order_type::text,
         CASE WHEN o.qr_revision > 0 THEN 'website' ELSE 'pos' END,
         count(*)
  FROM public.orders o
  CROSS JOIN LATERAL (SELECT o.created_at AT TIME ZONE 'Africa/Cairo' AS local_time) timing
  WHERE o.branch_id = p_branch AND o.status = 'completed'
    AND o.created_at >= ((cairo_today - p_days + 1)::timestamp AT TIME ZONE 'Africa/Cairo')
    AND o.created_at <= now()
  GROUP BY 1, 2, 3, 4
  ORDER BY 1, 2, 3, 4;
END;
$$;

CREATE FUNCTION public.get_workspace_stock_health(p_branch uuid, p_view text, p_offset integer DEFAULT 0)
RETURNS TABLE(
  item_type text, item_id uuid, item_name text, quantity numeric,
  usage_quantity numeric, cover_days numeric, batch_id uuid,
  batch_number text, expiry_date date
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  cairo_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  cutoff timestamptz := ((cairo_today - 30)::timestamp AT TIME ZONE 'Africa/Cairo');
  period_end timestamptz := (cairo_today::timestamp AT TIME ZONE 'Africa/Cairo');
BEGIN
  IF auth.uid() IS NULL OR p_branch IS NULL OR NOT COALESCE(public.user_may_access_branch(p_branch), false)
     OR NOT COALESCE(public.can_permission('inventory.view'), false)
     OR p_view IS NULL OR p_view NOT IN ('cover', 'idle', 'expiry')
     OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 50000 THEN
    RAISE EXCEPTION 'WORKSPACE_STOCK_HEALTH_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;

  IF p_view = 'expiry' THEN
    RETURN QUERY
    SELECT lots.kind, lots.stock_id, lots.name, lots.on_hand, NULL::numeric, NULL::numeric,
           lots.lot_id, lots.lot_number, lots.expires
    FROM (
      SELECT 'raw'::text AS kind, b.raw_material_id AS stock_id, m.name::text AS name,
             b.quantity::numeric AS on_hand, b.id AS lot_id, b.batch_number::text AS lot_number, b.expiry_date AS expires
      FROM public.raw_material_batches b
      JOIN public.raw_materials m ON m.id = b.raw_material_id AND m.branch_id = b.branch_id
      WHERE b.branch_id = p_branch AND b.quantity > 0 AND b.expiry_date <= cairo_today + 30
      UNION ALL
      SELECT 'manufactured', b.unit_id, u.name::text, b.quantity::numeric, b.id, b.batch_number::text, b.expiry_date
      FROM public.inventory_unit_batches b
      JOIN public.inventory_units u ON u.id = b.unit_id AND u.branch_id = b.branch_id
      WHERE b.branch_id = p_branch AND b.quantity > 0 AND b.expiry_date <= cairo_today + 30
    ) lots
    ORDER BY lots.expires, lots.name, lots.lot_id LIMIT 51 OFFSET p_offset;
    RETURN;
  END IF;

  IF NOT COALESCE(public.can_permission('inventory.ledger.view'), false)
     OR NOT COALESCE(public.can_permission('history.unlimited'), false) THEN
    RAISE EXCEPTION 'WORKSPACE_STOCK_HISTORY_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH stock AS (
    SELECT b.item_type AS kind, b.item_id AS id, min(b.item_name) AS name, sum(b.quantity) AS on_hand
    FROM public.v_stock_balances_unified b WHERE b.branch_id = p_branch
    GROUP BY b.item_type, b.item_id
  ), events AS (
    SELECT CASE WHEN l.product_id IS NULL THEN 'raw' ELSE 'product' END AS kind,
           COALESCE(l.product_id, l.raw_material_id) AS id, l.quantity AS movement
    FROM public.inventory_ledger l
    WHERE l.branch_id = p_branch AND l.created_at >= cutoff AND l.created_at < period_end
      AND (l.entry_type IN ('sale', 'refund', 'kitchen_send', 'kitchen_void') OR (l.entry_type = 'production' AND l.raw_material_id IS NOT NULL))
    UNION ALL
    SELECT 'manufactured', u.unit_id, u.quantity
    FROM public.inventory_unit_entries u
    WHERE u.branch_id = p_branch AND u.created_at >= cutoff AND u.created_at < period_end
      AND (u.entry_type IN ('sale', 'refund', 'kitchen_send', 'kitchen_void') OR (u.entry_type = 'production' AND u.quantity < 0))
  ), demand AS (
    SELECT e.kind, e.id, GREATEST(-sum(e.movement), 0) AS consumed,
           bool_or(e.movement < 0) AS issued
    FROM events e GROUP BY e.kind, e.id
  ), metrics AS (
    SELECT s.kind, s.id, s.name, s.on_hand, COALESCE(d.consumed, 0) AS consumed,
           CASE WHEN d.consumed > 0 THEN round(GREATEST(s.on_hand, 0) * 30 / d.consumed, 1) END AS days,
           COALESCE(d.issued, false) AS issued
    FROM stock s LEFT JOIN demand d ON d.kind = s.kind AND d.id = s.id
  )
  SELECT m.kind, m.id, m.name, m.on_hand, m.consumed, m.days, NULL::uuid, NULL::text, NULL::date
  FROM metrics m
  WHERE (p_view = 'cover' AND m.days IS NOT NULL) OR (p_view = 'idle' AND m.on_hand > 0 AND NOT m.issued)
  ORDER BY m.days NULLS LAST, m.name, m.kind, m.id LIMIT 51 OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_order_hours(uuid, integer), public.get_workspace_stock_health(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_order_hours(uuid, integer), public.get_workspace_stock_health(uuid, text, integer) TO authenticated;
