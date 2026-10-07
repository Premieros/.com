-- Unify subscription runtime on the tenant-level subscriptions table.
-- branch_subscriptions remains legacy/reference only.
-- Every branch now derives its subscription status from its owning organization.

CREATE OR REPLACE FUNCTION public.subscription_status(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id uuid;
  v_sub public.subscriptions%ROWTYPE;
  v_status text;
  v_expired boolean := true;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN jsonb_build_object('status','none','expired',true,'error','BRANCH_REQUIRED');
  END IF;

  IF auth.uid() IS NOT NULL
     AND NOT public.is_super_admin()
     AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object(
      'branch_id', p_branch_id,
      'status','denied',
      'expired',true,
      'error','BRANCH_ACCESS_DENIED'
    );
  END IF;

  SELECT b.organization_id
  INTO v_org_id
  FROM public.branches b
  WHERE b.id = p_branch_id
    AND b.is_active = true;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'branch_id', p_branch_id,
      'status','none',
      'expired',true,
      'error','BRANCH_NOT_FOUND'
    );
  END IF;

  SELECT s.*
  INTO v_sub
  FROM public.subscriptions s
  WHERE s.tenant_id = v_org_id
  ORDER BY s.updated_at DESC, s.created_at DESC
  LIMIT 1;

  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object(
      'branch_id', p_branch_id,
      'organization_id', v_org_id,
      'status','none',
      'expired',true
    );
  END IF;

  v_status := v_sub.status;

  IF v_status = 'trialing' THEN
    v_expired := v_sub.trial_ends_at IS NOT NULL AND v_sub.trial_ends_at <= now();
    IF v_expired THEN v_status := 'expired'; END IF;
  ELSIF v_status IN ('active','past_due') THEN
    v_expired := v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end <= now();
    IF v_expired THEN v_status := 'expired'; END IF;
  ELSE
    v_expired := v_status IN ('suspended','cancelled','expired');
  END IF;

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'organization_id', v_org_id,
    'subscription_id', v_sub.id,
    'status', v_status,
    'plan_id', v_sub.plan_id,
    'expired', v_expired,
    'trial_ends_at', v_sub.trial_ends_at,
    'current_period_ends_at', v_sub.current_period_end,
    'cancelled_at', v_sub.cancelled_at,
    'source', 'organization_subscription'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.subscription_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscription_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_status(uuid) TO service_role;

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
        FROM public.subscriptions s
        WHERE s.tenant_id = p_organization_id
          AND (
            (
              s.status = 'trialing'
              AND (s.trial_ends_at IS NULL OR s.trial_ends_at > now())
            )
            OR (
              s.status IN ('active','past_due')
              AND (s.current_period_end IS NULL OR s.current_period_end > now())
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
