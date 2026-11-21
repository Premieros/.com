-- Shared live-order readiness; changing readiness never enables QR ordering.
-- After staging sale/KDS tests have passed, replace the BUNKER-only validator
-- with this branch-scoped contract. Cost and pre-created raw stock are NOT gates.
CREATE OR REPLACE FUNCTION qr_private.branch_live_menu_ready(p_branch uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
WITH menu AS (
  SELECT p.id, p.category_id, p.is_demo
  FROM qr_private.menu_products m
  JOIN public.products p ON p.id=m.product_id AND p.branch_id=m.branch_id
  WHERE m.branch_id=p_branch AND p.is_active
), staff AS (
  SELECT 1 FROM public.user_branch_access uba
  JOIN auth.users au ON au.id=uba.user_id
  JOIN public.branches b ON b.id=uba.branch_id
  JOIN public.organization_members om ON om.user_id=uba.user_id
    AND om.organization_id=b.organization_id AND om.is_active
  WHERE uba.branch_id=p_branch LIMIT 1
)
SELECT
  EXISTS(SELECT 1 FROM menu)
  AND NOT EXISTS(SELECT 1 FROM menu WHERE is_demo IS TRUE)
  AND EXISTS(SELECT 1 FROM staff)
  AND EXISTS(SELECT 1 FROM public.warehouses w
             WHERE w.branch_id=p_branch AND w.is_active)
  AND EXISTS(SELECT 1 FROM public.dining_tables t
             WHERE t.branch_id=p_branch AND t.is_active)
  AND NOT EXISTS(
    SELECT 1 FROM menu m
    LEFT JOIN public.categories c ON c.id=m.category_id AND c.branch_id=p_branch
    LEFT JOIN public.kitchen_stations k ON k.id=c.kitchen_station_id
      AND k.branch_id=p_branch AND k.is_active
    WHERE c.id IS NULL OR k.id IS NULL
  )
$fn$;

REVOKE ALL ON FUNCTION qr_private.branch_live_menu_ready(uuid)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.branch_live_menu_ready(uuid)
TO service_role,postgres;

-- Compatibility only; no toggles or branch activation are changed.
CREATE OR REPLACE FUNCTION qr_private.bunker_live_menu_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
SELECT qr_private.branch_live_menu_ready(
  'd56aae83-f1b3-4153-9224-87594500368d'::uuid
)
$fn$;

REVOKE ALL ON FUNCTION qr_private.bunker_live_menu_ready()
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.bunker_live_menu_ready()
TO service_role,postgres;

COMMENT ON FUNCTION qr_private.branch_live_menu_ready(uuid) IS
'Shared branch-scoped menu routing/staff/warehouse/table check. Zero product cost and absent preconfigured raw recipe do not block sale; separate sale-path auto-material logic must pass staging E2E before enabling live intake.';