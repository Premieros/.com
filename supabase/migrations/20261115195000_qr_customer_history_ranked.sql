-- Customer-order history and ranking: join by private QR profile / visit / order
-- identifiers, never guess that a CRM customer matches by phone.
-- Shared orders linked to more than one guest cannot be attributed to one payer;
-- retain their request histories but exclude those sales from individual ranking.
-- Sales explicitly tied to a separate CRM account are also not attributed
-- to the unverified QR profile.
-- Read-only, branch- and permission-scoped, capped for safe dashboard payloads.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';

CREATE OR REPLACE FUNCTION qr_private.branch_customer_history(p_branch uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE result jsonb;
BEGIN
  PERFORM qr_private.require_staff(p_branch, 'customers.view');
  WITH profiles AS (
    SELECT p.id, p.name, p.phone, p.branch_id, p.created_at
    FROM qr_private.customer_profiles p WHERE p.branch_id = p_branch
  ),
  linked_orders AS (
    SELECT DISTINCT v.profile_id, o.id AS order_id
    FROM qr_private.visits v
    JOIN public.orders o ON o.id = v.order_id AND o.branch_id = p_branch
    WHERE v.branch_id = p_branch AND v.profile_id IS NOT NULL
    UNION
    SELECT DISTINCT v.profile_id, o.id
    FROM qr_private.visits v
    JOIN qr_private.requests r ON r.visit_id = v.id AND r.branch_id = p_branch AND r.status = 'accepted'
    JOIN public.orders o ON o.id = COALESCE(r.order_id, r.target_order_id) AND o.branch_id = p_branch
    WHERE v.branch_id = p_branch AND v.profile_id IS NOT NULL
  ),
  unambiguous_orders AS (
    SELECT l.profile_id, l.order_id
    FROM linked_orders l
    WHERE NOT EXISTS (
      SELECT 1 FROM linked_orders other
      WHERE other.order_id = l.order_id AND other.profile_id <> l.profile_id
    )
  ),
  completed_sales AS (
    SELECT DISTINCT l.profile_id, s.id, s.total, s.refunded_amount
    FROM unambiguous_orders l
    JOIN public.sales s ON s.source_order_id = l.order_id AND s.branch_id = p_branch
    WHERE s.status = 'completed' AND s.customer_id IS NULL
  ),
  purchase_totals AS (
    SELECT profile_id,
      count(*)::integer AS purchase_count,
      coalesce(sum(greatest(0, total - coalesce(refunded_amount, 0))), 0) AS total_spent
    FROM completed_sales GROUP BY profile_id
  ),
  rating_totals AS (
    SELECT v.profile_id, count(*)::integer AS rating_count, round(avg(g.overall)::numeric, 2) AS average_rating
    FROM qr_private.guest_ratings g
    JOIN qr_private.visits v ON v.id = g.visit_id AND v.branch_id = p_branch
    WHERE g.branch_id = p_branch AND v.profile_id IS NOT NULL
    GROUP BY v.profile_id
  )
  SELECT coalesce(jsonb_agg(to_jsonb(final_row) ORDER BY final_row.total_spent DESC, final_row.name, final_row.id),'[]'::jsonb)
  INTO result FROM (
    SELECT p.id, p.branch_id, p.name, p.phone,
      coalesce(t.purchase_count,0) AS purchase_count,
      coalesce(t.total_spent,0) AS total_spent,
      coalesce(rt.rating_count,0) AS rating_count,
      rt.average_rating,
      (
        SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC),'[]'::jsonb)
        FROM (
          SELECT r.id, r.created_at, r.status, r.order_type,
            coalesce(dt.name,'—') AS table_name,
            o.order_number, o.status AS order_status,
            CASE WHEN s.status = 'completed' AND s.customer_id IS NULL AND EXISTS (
              SELECT 1 FROM unambiguous_orders u
              WHERE u.order_id = o.id AND u.profile_id = p.id
            ) THEN greatest(0, s.total - coalesce(s.refunded_amount,0))
              ELSE NULL END AS paid_value
          FROM qr_private.visits v
          JOIN qr_private.requests r ON r.visit_id = v.id AND r.branch_id = p_branch
          LEFT JOIN public.orders o ON o.id = coalesce(r.order_id,r.target_order_id)
            AND o.branch_id = p_branch
          LEFT JOIN public.dining_tables dt ON dt.id = coalesce(r.assigned_table_id,r.requested_table_id)
            AND dt.branch_id = p_branch
          LEFT JOIN LATERAL (
            SELECT s.status, s.total, s.refunded_amount, s.customer_id
            FROM public.sales s WHERE s.source_order_id = o.id AND s.branch_id = p_branch
            ORDER BY s.created_at DESC LIMIT 1
          ) s ON true
          WHERE v.profile_id = p.id AND v.branch_id = p_branch
          ORDER BY r.created_at DESC LIMIT 50
        ) h
      ) AS orders,
      (
        SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC),'[]'::jsonb)
        FROM (
          SELECT g.overall, g.food, g.service, g.note, g.created_at
          FROM qr_private.visits v
          JOIN qr_private.guest_ratings g ON g.visit_id = v.id AND g.branch_id = p_branch
          WHERE v.branch_id = p_branch AND v.profile_id = p.id
          ORDER BY g.created_at DESC LIMIT 20
        ) a
      ) AS ratings,
      (
        SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC),'[]'::jsonb)
        FROM (
          SELECT c.id, c.kind, c.status, c.note, c.created_at,
            coalesce(dt.name, '—') AS table_name
          FROM qr_private.visits v
          JOIN qr_private.service_calls c ON c.visit_id = v.id AND c.branch_id = p_branch
          LEFT JOIN public.dining_tables dt ON dt.id = c.table_id AND dt.branch_id = p_branch
          WHERE v.profile_id = p.id AND v.branch_id = p_branch
          ORDER BY c.created_at DESC LIMIT 30
        ) h
      ) AS service_history
    FROM profiles p
    LEFT JOIN purchase_totals t ON t.profile_id = p.id
    LEFT JOIN rating_totals rt ON rt.profile_id = p.id
    ORDER BY coalesce(t.total_spent,0) DESC, p.name, p.id LIMIT 250
  ) final_row;
  RETURN coalesce(result,'[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION qr_private.branch_customer_history(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION qr_private.branch_customer_history(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.qr_customer_history(p_branch uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT qr_private.branch_customer_history(p_branch) $$;
REVOKE ALL ON FUNCTION public.qr_customer_history(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qr_customer_history(uuid) TO authenticated;

COMMENT ON FUNCTION public.qr_customer_history(uuid) IS
'Read-only ranked QR guest profiles, settled purchases, request history and visit ratings. Requires customers.view and permitted branch; no phone-based CRM merges.';
