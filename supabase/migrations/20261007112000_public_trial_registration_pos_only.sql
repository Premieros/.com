-- Public 14-day trial registration + POS-only fallback after expiry.
-- Existing administrative registration RPCs remain private.

CREATE OR REPLACE FUNCTION public.register_trial_tenant(
  p_store_name text,
  p_owner_name text,
  p_email text,
  p_password text,
  p_business_type text DEFAULT 'retail',
  p_store_name_en text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_currency text DEFAULT 'EGP'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_org_id uuid;
  v_type text := lower(btrim(COALESCE(p_business_type, 'retail')));
BEGIN
  IF v_type <> ALL(ARRAY[
    'restaurant','food_manufacturing','pharmacy','car_showroom',
    'tourism','retail','services','custom'
  ]) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_BUSINESS_TYPE');
  END IF;

  v_result := public.register_tenant(
    p_store_name,
    p_owner_name,
    p_email,
    p_password,
    p_store_name_en,
    p_phone,
    p_address,
    p_currency
  );

  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RETURN v_result;
  END IF;

  v_org_id := (v_result->>'organization_id')::uuid;

  UPDATE public.organizations
  SET
    business_type = v_type,
    business_profile = jsonb_build_object('preset_key', v_type)
  WHERE id = v_org_id;

  RETURN v_result || jsonb_build_object(
    'business_type', v_type,
    'trial_days', 14
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.register_trial_tenant(
  text,text,text,text,text,text,text,text,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_trial_tenant(
  text,text,text,text,text,text,text,text,text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.register_trial_tenant(
  text,text,text,text,text,text,text,text,text
) TO anon;
GRANT EXECUTE ON FUNCTION public.register_trial_tenant(
  text,text,text,text,text,text,text,text,text
) TO service_role;

-- Keep the database-backed module catalog aligned with the commercial rule:
-- full product during trial/paid period; POS module only after expiry.
CREATE OR REPLACE FUNCTION public.get_organization_module_catalog(
  p_organization_id uuid
)
RETURNS TABLE(
  feature_key text,
  feature_name text,
  category text,
  enabled boolean,
  source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH entitlement AS (
    SELECT
      public.is_super_admin()
      OR EXISTS (
        SELECT 1
        FROM public.branches b
        JOIN public.branch_subscriptions bs ON bs.branch_id = b.id
        WHERE b.organization_id = p_organization_id
          AND (
            (bs.status = 'trial' AND bs.trial_ends_at > now())
            OR (
              bs.status IN ('active', 'past_due')
              AND (bs.current_period_ends_at IS NULL OR bs.current_period_ends_at > now())
            )
          )
      ) AS full_access
  )
  SELECT
    f.key,
    f.name,
    f.category,
    CASE
      WHEN e.full_access THEN COALESCE(ofo.enabled, true)
      WHEN f.key = 'pos' THEN true
      ELSE false
    END AS enabled,
    CASE
      WHEN NOT e.full_access AND f.key = 'pos' THEN 'expired_pos_only'
      WHEN NOT e.full_access THEN 'expired_locked'
      WHEN ofo.id IS NULL THEN 'default_enabled'
      ELSE 'organization_override'
    END AS source
  FROM public.features f
  CROSS JOIN entitlement e
  LEFT JOIN public.organization_feature_overrides ofo
    ON ofo.feature_id = f.id
   AND ofo.organization_id = p_organization_id
  WHERE f.is_active = true
    AND (
      public.is_super_admin()
      OR public.user_can_access_organization(p_organization_id)
    )
  ORDER BY f.category, f.name;
$function$;

REVOKE ALL ON FUNCTION public.get_organization_module_catalog(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_organization_module_catalog(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_organization_module_catalog(uuid) TO service_role;
