-- Premier pricing policy: the latest approved/published unit price is authoritative.
-- Explicit zero is a valid approved price; missing history also evaluates to zero.
-- Legacy inventory averages remain stored only for old/historical batch valuation.
-- Do not rewrite ledger, batches, journals, or user pricing history.
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='45s';

ALTER TABLE public.raw_material_price_events
 DROP CONSTRAINT IF EXISTS raw_material_price_events_unit_cost_check;
ALTER TABLE public.raw_material_price_events
 ADD CONSTRAINT raw_material_price_events_unit_cost_check CHECK (unit_cost >= 0);

CREATE OR REPLACE FUNCTION public.set_raw_material_price(p_raw_material_id uuid, p_branch_id uuid, p_unit_cost numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_material_branch uuid;
  v_event_id uuid := gen_random_uuid();
  v_priced_at timestamptz := clock_timestamp();
  v_reference text;
  v_role text := COALESCE(current_setting('role', true), '');
BEGIN
  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PRICE');
  END IF;

  SELECT rm.branch_id
  INTO v_material_branch
  FROM public.raw_materials rm
  WHERE rm.id = p_raw_material_id
    AND rm.is_active = true
  FOR UPDATE;

  IF v_material_branch IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RAW_MATERIAL_NOT_FOUND');
  END IF;

  IF p_branch_id IS NULL OR p_branch_id <> v_material_branch THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF v_role <> 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;
    IF NOT public.can_permission('raw_materials.manage') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'PERMISSION_DENIED',
        'permission', 'raw_materials.manage'
      );
    END IF;
    IF NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
  END IF;

  v_reference :=
    'PRICE-' ||
    to_char(v_priced_at, 'YYYYMMDD-HH24MISSMS') ||
    '-' ||
    upper(substr(replace(v_event_id::text, '-', ''), 1, 6));

  INSERT INTO public.raw_material_price_events(
    id,
    raw_material_id,
    branch_id,
    unit_cost,
    source,
    reference_number,
    detail,
    priced_at,
    created_by
  )
  VALUES (
    v_event_id,
    p_raw_material_id,
    p_branch_id,
    round(p_unit_cost, 6),
    'pricing',
    v_reference,
    NULLIF(btrim(COALESCE(p_note, '')), ''),
    v_priced_at,
    auth.uid()
  );

  -- Keep default_cost aligned as the catalog fallback/reference value only.
  -- This does NOT alter raw_material_inventory.avg_cost or batch valuation.
  UPDATE public.raw_materials
  SET default_cost = round(p_unit_cost, 6)
  WHERE id = p_raw_material_id
    AND branch_id = p_branch_id;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'reference_number', v_reference,
    'unit_cost', round(p_unit_cost, 6),
    'source', 'pricing',
    'priced_at', v_priced_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._raw_cost_events_for_costing(p_raw_material_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(event_id text, raw_material_id uuid, branch_id uuid, unit_cost numeric, source text, priced_at timestamp with time zone, reference_number text, detail text, source_rank integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    il.id::text AS event_id,
    il.raw_material_id,
    il.branch_id,
    il.unit_cost::numeric(18,6),
    'purchase'::text AS source,
    il.created_at AS priced_at,
    COALESCE(NULLIF(il.reference_number, ''), p.invoice_number)::text,
    s.name::text,
    3
  FROM public.inventory_ledger il
  JOIN public.purchases p
    ON p.id = il.reference_id
   AND il.reference_type = 'purchase'
  LEFT JOIN public.suppliers s ON s.id = p.supplier_id
  WHERE il.raw_material_id IS NOT NULL
    AND il.entry_type = 'purchase'
    AND p.status = 'completed'
    AND il.unit_cost IS NOT NULL AND il.unit_cost >= 0
    AND (p_raw_material_id IS NULL OR il.raw_material_id = p_raw_material_id)
    AND (p_branch_id IS NULL OR il.branch_id = p_branch_id)
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)

  UNION ALL

  SELECT
    'legacy-purchase:' || pi.id::text,
    pi.raw_material_id,
    p.branch_id,
    (norm.value->>'stock_unit_cost')::numeric(18,6),
    'purchase'::text,
    COALESCE(p.approved_at, pi.created_at, p.created_at),
    p.invoice_number::text,
    s.name::text,
    3
  FROM public.purchase_items pi
  JOIN public.purchases p ON p.id = pi.purchase_id
  LEFT JOIN public.suppliers s ON s.id = p.supplier_id
  CROSS JOIN LATERAL (
    SELECT public._normalize_raw_purchase_uom(
      pi.raw_material_id,
      pi.quantity,
      pi.unit_cost,
      pi.unit_name
    ) AS value
  ) norm
  WHERE pi.raw_material_id IS NOT NULL
    AND p.status = 'completed'
    AND pi.unit_cost IS NOT NULL AND pi.unit_cost >= 0
    AND COALESCE((norm.value->>'success')::boolean, false)
    AND (norm.value->>'stock_unit_cost')::numeric >= 0
    AND (p_raw_material_id IS NULL OR pi.raw_material_id = p_raw_material_id)
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.inventory_ledger il
      WHERE il.reference_id = p.id
        AND il.reference_type = 'purchase'
        AND il.entry_type = 'purchase'
        AND il.raw_material_id = pi.raw_material_id
    )

  UNION ALL

  SELECT
    sci.id::text,
    sci.raw_material_id,
    sc.branch_id,
    sci.unit_cost::numeric(18,6),
    'stock_count'::text,
    COALESCE(sc.applied_at, sc.approved_at, sc.created_at),
    sc.count_number::text,
    sci.reason::text,
    2
  FROM public.stock_count_items sci
  JOIN public.stock_counts sc ON sc.id = sci.stock_count_id
  WHERE sci.raw_material_id IS NOT NULL
    AND sc.status = 'applied'
    AND sci.unit_cost IS NOT NULL AND sci.unit_cost >= 0
    AND (p_raw_material_id IS NULL OR sci.raw_material_id = p_raw_material_id)
    AND (p_branch_id IS NULL OR sc.branch_id = p_branch_id)

  UNION ALL

  SELECT
    'pricing:' || pe.id::text,
    pe.raw_material_id,
    pe.branch_id,
    pe.unit_cost::numeric(18,6),
    'pricing'::text,
    pe.priced_at,
    pe.reference_number::text,
    pe.detail::text,
    1
  FROM public.raw_material_price_events pe
  WHERE pe.unit_cost >= 0
    AND (p_raw_material_id IS NULL OR pe.raw_material_id = p_raw_material_id)
    AND (p_branch_id IS NULL OR pe.branch_id = p_branch_id);
$function$;

CREATE OR REPLACE FUNCTION public.get_costing_overview(p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(product_id uuid, product_name text, barcode text, sku text, category_name text, product_type text, sale_price numeric, unit_cost numeric, theoretical_cost numeric, actual_cost numeric, component_count bigint, recipe_item_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_branch uuid;
  v_scope uuid;
BEGIN
  IF NOT public.is_pos_admin() THEN
    SELECT u.branch_id INTO v_user_branch
    FROM public.users u
    WHERE u.id = auth.uid();
    v_scope := v_user_branch;
  ELSE
    v_scope := p_branch_id;
  END IF;

  RETURN QUERY
  WITH scoped_products AS MATERIALIZED (
    SELECT p.id, p.name, p.barcode, p.sku, p.category_id, p.branch_id, p.product_type, p.sale_price
    FROM public.products p
    WHERE p.is_active = true
      AND (v_scope IS NULL OR p.branch_id = v_scope)
  ),
  scoped_branches AS MATERIALIZED (
    SELECT DISTINCT sp.branch_id
    FROM scoped_products sp
    WHERE sp.branch_id IS NOT NULL
  ),
  scoped_raw_materials AS MATERIALIZED (
    SELECT rm.id, rm.branch_id, rm.default_cost
    FROM public.raw_materials rm
    JOIN scoped_branches sb ON sb.branch_id = rm.branch_id
  ),
  events AS MATERIALIZED (
    SELECT e.*
    FROM public._raw_cost_events_for_costing(NULL, v_scope) e
    JOIN scoped_branches sb ON sb.branch_id = e.branch_id
  ),
  ranked AS MATERIALIZED (
    SELECT e.*,
      ROW_NUMBER() OVER (
        PARTITION BY e.raw_material_id, e.branch_id
        ORDER BY e.priced_at DESC NULLS LAST, e.source_rank, e.reference_number DESC NULLS LAST, e.event_id DESC
      ) AS rn
    FROM events e
  ),
  inventory_latest AS MATERIALIZED (
    SELECT DISTINCT ON (rmi.raw_material_id, rmi.branch_id)
      rmi.raw_material_id, rmi.branch_id, rmi.avg_cost::numeric AS unit_cost
    FROM public.raw_material_inventory rmi
    JOIN scoped_raw_materials srm ON srm.id = rmi.raw_material_id AND srm.branch_id = rmi.branch_id
    WHERE COALESCE(rmi.avg_cost, 0) > 0
    ORDER BY rmi.raw_material_id, rmi.branch_id, rmi.updated_at DESC NULLS LAST, rmi.id DESC
  ),
  batch_average AS MATERIALIZED (
    SELECT b.raw_material_id, b.branch_id,
      NULLIF(SUM(b.quantity * COALESCE(b.unit_cost, 0)) / NULLIF(SUM(b.quantity), 0), 0)::numeric AS unit_cost
    FROM public.raw_material_batches b
    JOIN scoped_raw_materials srm ON srm.id = b.raw_material_id AND srm.branch_id = b.branch_id
    WHERE b.quantity > 0
    GROUP BY b.raw_material_id, b.branch_id
  ),
  raw_costs AS MATERIALIZED (
    SELECT srm.id AS raw_material_id, srm.branch_id,
      COALESCE(r1.unit_cost, 0)::numeric AS unit_cost
    FROM scoped_raw_materials srm
    LEFT JOIN ranked r1 ON r1.raw_material_id = srm.id AND r1.branch_id = srm.branch_id AND r1.rn = 1
    LEFT JOIN inventory_latest inv ON inv.raw_material_id = srm.id AND inv.branch_id = srm.branch_id
    LEFT JOIN batch_average ba ON ba.raw_material_id = srm.id AND ba.branch_id = srm.branch_id
  ),
  product_wavg AS MATERIALIZED (
    SELECT b.product_id, b.branch_id,
      CASE WHEN SUM(b.quantity) > 0
        THEN round(SUM(b.quantity * b.unit_cost) / SUM(b.quantity), 2)
        ELSE 0
      END::numeric AS unit_cost
    FROM public.inventory_batches b
    JOIN scoped_branches sb ON sb.branch_id = b.branch_id
    WHERE b.quantity > 0
    GROUP BY b.product_id, b.branch_id
  ),
  component_counts AS MATERIALIZED (
    SELECT pc.product_id, COUNT(*)::bigint AS component_count
    FROM public.product_components pc
    JOIN scoped_products sp ON sp.id = pc.product_id
    GROUP BY pc.product_id
  ),
  recipe_lines AS MATERIALIZED (
    SELECT
      r.product_id,
      ri.raw_material_id,
      ri.quantity::numeric AS quantity,
      COALESCE(ri.wastage_percent, 0)::numeric AS wastage_percent
    FROM public.recipes r
    JOIN scoped_products sp ON sp.id = r.product_id
    JOIN public.recipe_items ri ON ri.recipe_id = r.id
    WHERE v_scope IS NULL OR r.branch_id = v_scope

    UNION ALL

    SELECT
      pul.product_id,
      iur.raw_material_id,
      (pul.quantity * iur.quantity)::numeric AS quantity,
      COALESCE(iur.wastage_percent, 0)::numeric AS wastage_percent
    FROM public.product_unit_links pul
    JOIN scoped_products sp ON sp.id = pul.product_id
    JOIN public.inventory_units iu
      ON iu.id = pul.unit_id
     AND iu.unit_type = 'manufactured'
     AND iu.is_active = true
     AND (sp.branch_id IS NULL OR iu.branch_id = sp.branch_id)
    JOIN public.inventory_unit_recipes iur ON iur.unit_id = iu.id
  ),
  recipe_costs AS MATERIALIZED (
    SELECT
      rl.product_id,
      round(SUM(
        rl.quantity
        * (1 + rl.wastage_percent / 100.0)
        * COALESCE(rc.unit_cost, 0)
      ), 2)::numeric AS cost
    FROM recipe_lines rl
    LEFT JOIN raw_costs rc ON rc.raw_material_id = rl.raw_material_id
    GROUP BY rl.product_id
  ),
  recipe_counts AS MATERIALIZED (
    SELECT rl.product_id, COUNT(*)::bigint AS recipe_item_count
    FROM recipe_lines rl
    GROUP BY rl.product_id
  )
  SELECT
    sp.id,
    COALESCE(NULLIF(btrim(sp.name), ''), 'Product')::text,
    sp.barcode,
    sp.sku,
    c.name,
    COALESCE(sp.product_type, 'ready')::text,
    COALESCE(sp.sale_price, 0)::numeric(12,2),
    COALESCE(pw.unit_cost, 0)::numeric(12,2),
    COALESCE(rc.cost, 0)::numeric(12,2),
    COALESCE(rc.cost, 0)::numeric(12,2),
    COALESCE(cc.component_count, 0)::bigint,
    COALESCE(rct.recipe_item_count, 0)::bigint
  FROM scoped_products sp
  LEFT JOIN public.categories c ON c.id = sp.category_id
  LEFT JOIN product_wavg pw ON pw.product_id = sp.id AND pw.branch_id = sp.branch_id
  LEFT JOIN recipe_costs rc ON rc.product_id = sp.id
  LEFT JOIN component_counts cc ON cc.product_id = sp.id
  LEFT JOIN recipe_counts rct ON rct.product_id = sp.id
  ORDER BY sp.name ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_raw_material_cost_overview(p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(raw_material_id uuid, raw_material_name text, raw_material_code text, branch_id uuid, latest_cost numeric, previous_cost numeric, change_amount numeric, change_pct numeric, price_source text, priced_at timestamp with time zone, reference_number text, source_detail text, event_count bigint)
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
  WITH accessible_branches AS MATERIALIZED (
    SELECT b.id AS branch_id
    FROM public.branches b
    WHERE (p_branch_id IS NULL OR b.id = p_branch_id)
      AND (
        p_branch_id IS NOT NULL
        OR public.user_may_access_branch(b.id)
      )
  ),
  scoped_materials AS MATERIALIZED (
    SELECT
      rm.id,
      rm.name,
      rm.code,
      rm.branch_id,
      rm.default_cost
    FROM public.raw_materials rm
    JOIN accessible_branches ab
      ON ab.branch_id = rm.branch_id
    WHERE rm.is_active = true
  ),
  scoped_branches AS MATERIALIZED (
    SELECT DISTINCT sm.branch_id
    FROM scoped_materials sm
  ),
  events AS MATERIALIZED (
    SELECT e.*
    FROM public._raw_cost_events_for_costing(NULL, p_branch_id) e
    JOIN scoped_branches sb ON sb.branch_id = e.branch_id
  ),
  ranked AS MATERIALIZED (
    SELECT
      e.*,
      ROW_NUMBER() OVER (
        PARTITION BY e.raw_material_id, e.branch_id
        ORDER BY
          e.priced_at DESC NULLS LAST,
          e.source_rank,
          e.reference_number DESC NULLS LAST,
          e.event_id DESC
      ) AS rn,
      COUNT(*) OVER (
        PARTITION BY e.raw_material_id, e.branch_id
      )::bigint AS event_count
    FROM events e
  ),
  inventory_latest AS MATERIALIZED (
    SELECT DISTINCT ON (rmi.raw_material_id, rmi.branch_id)
      rmi.raw_material_id,
      rmi.branch_id,
      rmi.avg_cost::numeric(18,6) AS unit_cost,
      rmi.updated_at AS priced_at
    FROM public.raw_material_inventory rmi
    JOIN scoped_materials sm
      ON sm.id = rmi.raw_material_id
     AND sm.branch_id = rmi.branch_id
    WHERE COALESCE(rmi.avg_cost, 0) > 0
    ORDER BY
      rmi.raw_material_id,
      rmi.branch_id,
      rmi.updated_at DESC NULLS LAST,
      rmi.id DESC
  ),
  batch_average AS MATERIALIZED (
    SELECT
      b.raw_material_id,
      b.branch_id,
      NULLIF(
        SUM(b.quantity * COALESCE(b.unit_cost, 0))
        / NULLIF(SUM(b.quantity), 0),
        0
      )::numeric(18,6) AS unit_cost,
      MAX(b.created_at) AS priced_at
    FROM public.raw_material_batches b
    JOIN scoped_materials sm
      ON sm.id = b.raw_material_id
     AND sm.branch_id = b.branch_id
    WHERE b.quantity > 0
    GROUP BY b.raw_material_id, b.branch_id
  )
  SELECT
    sm.id,
    COALESCE(NULLIF(btrim(sm.name), ''), 'Raw Material')::text,
    sm.code::text,
    sm.branch_id,
    COALESCE(r1.unit_cost, 0)::numeric(18,6) AS latest_cost,
    r2.unit_cost::numeric(18,6) AS previous_cost,
    CASE
      WHEN r2.unit_cost IS NULL THEN NULL
      ELSE (
        COALESCE(r1.unit_cost, 0) - r2.unit_cost
      )::numeric(18,6)
    END AS change_amount,
    CASE
      WHEN COALESCE(r2.unit_cost, 0) <= 0 THEN NULL
      ELSE round(
        (
          COALESCE(r1.unit_cost, 0) - r2.unit_cost
        ) * 100.0 / r2.unit_cost,
        4
      )::numeric(12,4)
    END AS change_pct,
    COALESCE(r1.source, 'no_published_price')::text AS price_source,
    r1.priced_at AS priced_at,
    r1.reference_number::text,
    r1.detail::text,
    COALESCE(r1.event_count, 0)::bigint
  FROM scoped_materials sm
  LEFT JOIN ranked r1
    ON r1.raw_material_id = sm.id
   AND r1.branch_id = sm.branch_id
   AND r1.rn = 1
  LEFT JOIN ranked r2
    ON r2.raw_material_id = sm.id
   AND r2.branch_id = sm.branch_id
   AND r2.rn = 2
  LEFT JOIN inventory_latest inv
    ON inv.raw_material_id = sm.id
   AND inv.branch_id = sm.branch_id
  LEFT JOIN batch_average ba
    ON ba.raw_material_id = sm.id
   AND ba.branch_id = sm.branch_id
  ORDER BY sm.name ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public._raw_wavg_cost(p_raw_material_id uuid,p_branch_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
  -- Compatibility function: the policy is last approved price, NOT weighted average.
  -- Fail closed for missing branch rather than implicitly aggregating tenants.
  SELECT CASE WHEN p_branch_id IS NULL THEN 0
         ELSE COALESCE(public._raw_cost_for_costing(p_raw_material_id,p_branch_id),0)
         END::numeric
$function$;
