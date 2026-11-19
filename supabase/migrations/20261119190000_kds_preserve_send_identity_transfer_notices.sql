-- Existing read-only KDS queue: preserve original sent-at line identity.
-- Splitting/moving previously sent lines must never appear as fresh cooking.
CREATE OR REPLACE FUNCTION public.get_kitchen_queue(p_station text DEFAULT NULL::text, p_branch_id uuid DEFAULT get_branch_id())
 RETURNS TABLE(order_id uuid, order_number text, table_number integer, station text, kitchen_status text, guest_count integer, notes text, created_at timestamp with time zone, items jsonb, elapsed_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role text;
  v_has_assignments boolean;
  v_main_station_id uuid;
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
BEGIN
  IF p_branch_id IS NULL
     OR (NOT v_is_service_role AND NOT public.user_may_access_branch(p_branch_id))
     OR (NOT v_is_service_role AND NOT public.can_permission('pos.kds_view')) THEN
    RETURN;
  END IF;

  SELECT role
    INTO v_role
  FROM public.users
  WHERE id = auth.uid()
    AND is_active = true;

  -- `main` is branch-owned. Never pick another branch's same-code station.
  SELECT ks.id
    INTO v_main_station_id
  FROM public.kitchen_stations ks
  WHERE ks.branch_id = p_branch_id
    AND lower(btrim(ks.code)) = 'main'
    AND ks.is_active = true
  ORDER BY ks.sort_order, ks.id
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_kitchen_station_assignments a
    WHERE a.user_id = auth.uid()
      AND a.branch_id = p_branch_id
  ) INTO v_has_assignments;

  RETURN QUERY
  WITH sent_items AS (
    SELECT
      o.id AS oid,
      o.order_number AS onumber,
      o.kitchen_status AS kstatus,
      o.guest_count AS guests,
      o.notes AS onotes,
      COALESCE(o.kitchen_sent_at, MIN(oks.sent_at) OVER (PARTITION BY o.id), o.created_at) AS queue_at,
      oi.id AS item_id,
      (oks.sent_quantity - COALESCE(ksb.served_quantity, 0)) AS quantity,
      oi.notes AS item_notes,
      oi.modifiers_snapshot,
      p.name AS product_name,
      oks.sent_at AS original_sent_at,
      COALESCE(ks.id, v_main_station_id) AS station_id,
      COALESCE(ks.code, 'main') AS station_code
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    JOIN public.order_kitchen_sends oks ON oks.order_item_id = oi.id
    LEFT JOIN public.order_kitchen_served_quantities ksb
      ON ksb.order_id = o.id
     AND ksb.order_item_id = oi.id
    JOIN public.products p ON p.id = oi.product_id
    LEFT JOIN public.categories c
      ON c.id = p.category_id
     AND c.branch_id = o.branch_id
    LEFT JOIN public.kitchen_stations ks
      ON ks.id = c.kitchen_station_id
     AND ks.branch_id = o.branch_id
     AND ks.is_active = true
    WHERE o.branch_id = p_branch_id
      -- Payment completion must not remove unfinished kitchen work from KDS.
      AND o.status IN ('open', 'held', 'completed')
      AND o.kitchen_status IN ('sent', 'cooking', 'ready')
      AND COALESCE(oks.sent_quantity, 0) > COALESCE(ksb.served_quantity, 0)
  ),
  legacy_empty_orders AS (
    SELECT
      o.id AS oid,
      o.order_number AS onumber,
      o.kitchen_status AS kstatus,
      o.guest_count AS guests,
      o.notes AS onotes,
      COALESCE(o.kitchen_sent_at, o.created_at) AS queue_at,
      NULL::uuid AS item_id,
      NULL::numeric AS quantity,
      NULL::text AS item_notes,
      NULL::jsonb AS modifiers_snapshot,
      NULL::text AS product_name,
      NULL::timestamptz AS original_sent_at,
      COALESCE(
        legacy_station.id,
        CASE WHEN NULLIF(o.station, '') IS NULL THEN v_main_station_id ELSE NULL END
      ) AS station_id,
      COALESCE(NULLIF(o.station, ''), legacy_station.code, 'main') AS station_code
    FROM public.orders o
    LEFT JOIN public.kitchen_stations legacy_station
      ON legacy_station.branch_id = o.branch_id
     AND lower(btrim(legacy_station.code)) = lower(btrim(COALESCE(NULLIF(o.station, ''), 'main')))
     AND legacy_station.is_active = true
    WHERE o.branch_id = p_branch_id
      AND o.status IN ('open', 'held', 'completed')
      AND o.kitchen_status IN ('sent', 'cooking', 'ready')
      AND NOT EXISTS (
        SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.order_kitchen_sends oks WHERE oks.order_id = o.id
      )
  ),
  queue_items AS (
    SELECT * FROM sent_items
    UNION ALL
    SELECT * FROM legacy_empty_orders
  ),
  allowed_items AS (
    SELECT qi.*
    FROM queue_items qi
    WHERE (p_station IS NULL OR qi.station_code = p_station)
      AND (
        v_is_service_role
        OR public.can_permission('settings.manage')
        OR NOT v_has_assignments
        OR EXISTS (
          SELECT 1
          FROM public.user_kitchen_station_assignments a
          WHERE a.user_id = auth.uid()
            AND a.branch_id = p_branch_id
            AND a.station_id = qi.station_id
        )
      )
  )
  SELECT
    ai.oid,
    ai.onumber,
    NULL::integer,
    ai.station_code,
    ai.kstatus,
    ai.guests,
    ai.onotes,
    MIN(ai.queue_at),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'order_item_id', ai.item_id,
          'sent_at', ai.original_sent_at,
          'product_name', ai.product_name,
          'quantity', ai.quantity,
          'notes', ai.item_notes,
          'modifiers', COALESCE(ai.modifiers_snapshot, '[]'::jsonb)
        )
        ORDER BY ai.item_id
      ) FILTER (WHERE ai.item_id IS NOT NULL),
      '[]'::jsonb
    ),
    GREATEST(EXTRACT(EPOCH FROM (now() - MIN(ai.queue_at)))::integer, 0)
  FROM allowed_items ai
  GROUP BY ai.oid, ai.onumber, ai.station_code, ai.kstatus, ai.guests, ai.onotes
  ORDER BY MIN(ai.queue_at), ai.onumber, ai.station_code;
END;
$function$
;

CREATE INDEX IF NOT EXISTS idx_audit_kds_transfer_recent
 ON public.audit_log(branch_id,created_at DESC)
 WHERE action='ORDER_ITEMS_TABLE_TRANSFERRED';

-- Transfer banners are derived from an existing immutable audit record.
-- No new kitchen send, inventory entry or status update is produced here.
CREATE OR REPLACE FUNCTION public.get_kitchen_transfer_notices(
 p_branch_id uuid, p_station text DEFAULT NULL, p_limit integer DEFAULT 24
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
 v_rows jsonb;
 v_limit integer := greatest(1,least(coalesce(p_limit,24),48));
 v_assignments boolean;
 v_main_station uuid;
BEGIN
 IF auth.uid() IS NULL OR p_branch_id IS NULL
    OR NOT public.user_may_access_branch(p_branch_id)
    OR NOT public.can_permission('pos.kds_view') THEN
   RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
 END IF;
 SELECT EXISTS (
   SELECT 1 FROM public.user_kitchen_station_assignments a
   WHERE a.user_id=auth.uid() AND a.branch_id=p_branch_id
 ) INTO v_assignments;
 SELECT id INTO v_main_station FROM public.kitchen_stations
 WHERE branch_id=p_branch_id AND lower(btrim(code))='main' AND is_active
 ORDER BY sort_order,id LIMIT 1;

 WITH recent_logs AS (
  SELECT a.id,a.created_at,a.details
  FROM public.audit_log a
  WHERE a.branch_id=p_branch_id
    AND a.action='ORDER_ITEMS_TABLE_TRANSFERRED'
    AND a.created_at>=now()-interval '2 hours'
    AND coalesce((a.details->>'moved_sent_item_count')::integer,0)>0
  ORDER BY a.created_at DESC,a.id DESC
  LIMIT 60
 ), moved_lines AS (
  SELECT l.id AS event_id,l.created_at,l.details,
    (q.part->>'moved_item_id')::uuid moved_item_id,
    (q.part->>'quantity')::numeric moved_quantity
  FROM recent_logs l
  CROSS JOIN LATERAL jsonb_array_elements(
   coalesce(l.details->'quantity_transfers','[]'::jsonb)) AS q(part)
 ), station_lines AS (
  SELECT m.event_id,m.created_at,m.details,m.moved_quantity,
    oi.id item_id,oi.product_id,p.name product_name,
    LEAST(m.moved_quantity,oks.sent_quantity) sent_quantity,
    coalesce(ks.code,'main') station_code,
    coalesce(ks.id,v_main_station) station_id
  FROM moved_lines m
  JOIN public.order_items oi ON oi.id=m.moved_item_id
  JOIN public.order_kitchen_sends oks
   ON oks.order_item_id=oi.id AND oks.branch_id=p_branch_id
     AND oks.sent_quantity>0
  JOIN public.products p ON p.id=oi.product_id
  LEFT JOIN public.categories c
   ON c.id=p.category_id AND c.branch_id=p_branch_id
  LEFT JOIN public.kitchen_stations ks
   ON ks.id=c.kitchen_station_id
    AND ks.branch_id=p_branch_id AND ks.is_active
  WHERE (p_station IS NULL OR coalesce(ks.code,'main')=p_station)
    AND (
      public.can_permission('settings.manage')
      OR NOT v_assignments
      OR EXISTS (
        SELECT 1 FROM public.user_kitchen_station_assignments a
        WHERE a.user_id=auth.uid() AND a.branch_id=p_branch_id
          AND a.station_id=coalesce(ks.id,v_main_station)
      )
    )
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'event_id',n.event_id,'created_at',n.created_at,
   'product_name',n.product_name,
   'quantity',n.sent_quantity,
   'station',n.station_code,
   'split_bill',coalesce((n.details->>'split_bill')::boolean,false),
   'source_table',coalesce(st.name,''),
   'target_table',coalesce(tt.name,''),
   'target_order_number',coalesce(o.order_number,'')
 ) ORDER BY n.created_at DESC,n.event_id DESC),'[]'::jsonb)
 INTO v_rows
 FROM (SELECT * FROM station_lines ORDER BY created_at DESC,event_id DESC LIMIT v_limit) n
 LEFT JOIN public.dining_tables st ON st.id=(n.details->>'source_table_id')::uuid
   AND st.branch_id=p_branch_id
 LEFT JOIN public.dining_tables tt ON tt.id=(n.details->>'target_table_id')::uuid
   AND tt.branch_id=p_branch_id
 LEFT JOIN public.orders o ON o.id=(n.details->>'target_order_id')::uuid
   AND o.branch_id=p_branch_id;

 RETURN jsonb_build_object('success',true,'rows',v_rows);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_kitchen_transfer_notices(uuid,text,integer)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_kitchen_transfer_notices(uuid,text,integer)
 TO authenticated;
