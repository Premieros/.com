-- Organization-scoped module controls.
-- This extends the existing feature registry without reviving the retired
-- subscription UI/runtime gate. Default behavior remains enabled unless an
-- explicit organization override exists.
--
-- Safety:
--   * Super Admin is the only writer.
--   * Tenant users can read only their own organization module state.
--   * Disabling a module never deletes historical data.
--   * Permission/RLS checks remain independent and mandatory.

INSERT INTO public.features (key, name, description, category, is_system)
VALUES
  ('catalog', 'المنتجات والمكونات', 'إدارة المنتجات والتسعير والتصنيفات والمكونات', 'core', true),
  ('expenses', 'المصروفات', 'إدارة مصروفات التشغيل وربطها بالفرع والخزينة', 'finance', true),
  ('approvals', 'الموافقات', 'مركز الموافقات والسياسات المرتبطة بها', 'management', true),
  ('data_exchange', 'الاستيراد والتصدير', 'استيراد وتصدير البيانات والتقارير', 'management', false)
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    is_system = EXCLUDED.is_system,
    is_active = true,
    updated_at = now();

CREATE TABLE IF NOT EXISTS public.organization_feature_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature_id uuid NOT NULL REFERENCES public.features(id) ON DELETE CASCADE,
  enabled boolean NOT NULL,
  reason text,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_org_feature_overrides_org
  ON public.organization_feature_overrides (organization_id);

CREATE INDEX IF NOT EXISTS idx_org_feature_overrides_feature
  ON public.organization_feature_overrides (feature_id);

ALTER TABLE public.organization_feature_overrides ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.organization_feature_overrides FROM PUBLIC;
REVOKE ALL ON TABLE public.organization_feature_overrides FROM anon;
REVOKE ALL ON TABLE public.organization_feature_overrides FROM authenticated;
GRANT SELECT ON TABLE public.organization_feature_overrides TO authenticated;

DROP POLICY IF EXISTS organization_feature_overrides_select
  ON public.organization_feature_overrides;

CREATE POLICY organization_feature_overrides_select
ON public.organization_feature_overrides
FOR SELECT
TO authenticated
USING (
  public.is_super_admin()
  OR public.user_can_access_organization(organization_id)
);

CREATE OR REPLACE FUNCTION public.user_can_access_organization(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = p_organization_id
        AND om.user_id = auth.uid()
        AND om.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.users u
      JOIN public.branches b ON b.id = u.branch_id
      WHERE u.id = auth.uid()
        AND u.is_active = true
        AND b.organization_id = p_organization_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_branch_access uba
      JOIN public.branches b ON b.id = uba.branch_id
      WHERE uba.user_id = auth.uid()
        AND b.organization_id = p_organization_id
    );
$function$;

REVOKE ALL ON FUNCTION public.user_can_access_organization(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_can_access_organization(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_can_access_organization(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_organization(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_feature_access(
  p_tenant_id uuid DEFAULT NULL::uuid,
  p_branch_id uuid DEFAULT NULL::uuid,
  p_feature_key text DEFAULT NULL::text,
  p_user_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tid uuid := p_tenant_id;
  v_bid uuid := p_branch_id;
  v_feature_id uuid;
  v_org_active boolean;
  v_org_override boolean;
  v_branch_override boolean;
  v_branch_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'feature_key', p_feature_key,
      'error', 'AUTH_REQUIRED'
    );
  END IF;

  IF btrim(COALESCE(p_feature_key, '')) = '' THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'feature_key', p_feature_key,
      'error', 'FEATURE_REQUIRED'
    );
  END IF;

  -- Platform Super Admin is the only implicit cross-tenant bypass.
  IF public.is_super_admin() THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'feature_key', p_feature_key,
      'limit_value', -1,
      'is_unlimited', true,
      'source', 'platform_admin'
    );
  END IF;

  IF v_bid IS NULL THEN
    v_bid := public.get_branch_id();
  END IF;

  IF v_bid IS NOT NULL THEN
    SELECT b.organization_id
      INTO v_branch_tenant
    FROM public.branches b
    WHERE b.id = v_bid;

    IF v_branch_tenant IS NULL THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'feature_key', p_feature_key,
        'error', 'BRANCH_NOT_FOUND'
      );
    END IF;

    IF NOT public.user_may_access_branch(v_bid) THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'feature_key', p_feature_key,
        'error', 'BRANCH_ACCESS_DENIED'
      );
    END IF;

    IF v_tid IS NULL THEN
      v_tid := v_branch_tenant;
    ELSIF v_tid IS DISTINCT FROM v_branch_tenant THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'feature_key', p_feature_key,
        'error', 'BRANCH_TENANT_MISMATCH'
      );
    END IF;
  END IF;

  IF v_tid IS NULL THEN
    SELECT om.organization_id
      INTO v_tid
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
      AND om.is_active = true
    ORDER BY om.created_at
    LIMIT 1;
  END IF;

  IF v_tid IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'feature_key', p_feature_key,
      'error', 'ORGANIZATION_NOT_FOUND'
    );
  END IF;

  IF NOT public.user_can_access_organization(v_tid) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'feature_key', p_feature_key,
      'error', 'ORGANIZATION_ACCESS_DENIED'
    );
  END IF;

  SELECT o.is_active
    INTO v_org_active
  FROM public.organizations o
  WHERE o.id = v_tid;

  IF v_org_active IS DISTINCT FROM true THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'feature_key', p_feature_key,
      'organization_id', v_tid,
      'error', 'ORGANIZATION_DISABLED'
    );
  END IF;

  SELECT f.id
    INTO v_feature_id
  FROM public.features f
  WHERE f.key = p_feature_key
    AND f.is_active = true;

  IF v_feature_id IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'feature_key', p_feature_key,
      'organization_id', v_tid,
      'error', 'FEATURE_NOT_FOUND'
    );
  END IF;

  -- Organization controls are authoritative. A disabled organization module
  -- cannot be re-enabled accidentally by an older branch override.
  SELECT ofo.enabled
    INTO v_org_override
  FROM public.organization_feature_overrides ofo
  WHERE ofo.organization_id = v_tid
    AND ofo.feature_id = v_feature_id;

  IF FOUND AND v_org_override = false THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'feature_key', p_feature_key,
      'organization_id', v_tid,
      'branch_id', v_bid,
      'limit_value', NULL,
      'is_unlimited', true,
      'source', 'organization_override'
    );
  END IF;

  -- Branch overrides may narrow an enabled/default organization module.
  IF v_bid IS NOT NULL THEN
    SELECT bfo.enabled
      INTO v_branch_override
    FROM public.branch_feature_overrides bfo
    WHERE bfo.tenant_id = v_tid
      AND bfo.branch_id = v_bid
      AND bfo.feature_id = v_feature_id;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'allowed', v_branch_override,
        'feature_key', p_feature_key,
        'organization_id', v_tid,
        'branch_id', v_bid,
        'limit_value', NULL,
        'is_unlimited', true,
        'source', 'branch_override'
      );
    END IF;
  END IF;

  IF v_org_override IS NOT NULL THEN
    RETURN jsonb_build_object(
      'allowed', v_org_override,
      'feature_key', p_feature_key,
      'organization_id', v_tid,
      'branch_id', v_bid,
      'limit_value', NULL,
      'is_unlimited', true,
      'source', 'organization_override'
    );
  END IF;

  -- Backward-compatible default: modules remain enabled until explicitly
  -- disabled for an organization.
  RETURN jsonb_build_object(
    'allowed', true,
    'feature_key', p_feature_key,
    'organization_id', v_tid,
    'branch_id', v_bid,
    'limit_value', NULL,
    'is_unlimited', true,
    'source', 'default_enabled'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_feature_access(uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_feature_access(uuid, uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_feature_access(uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_feature_access(uuid, uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_organization_module_catalog(
  p_organization_id uuid
)
RETURNS TABLE (
  feature_key text,
  feature_name text,
  category text,
  enabled boolean,
  source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    f.key,
    f.name,
    f.category,
    COALESCE(ofo.enabled, true) AS enabled,
    CASE WHEN ofo.id IS NULL THEN 'default_enabled' ELSE 'organization_override' END AS source
  FROM public.features f
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
REVOKE ALL ON FUNCTION public.get_organization_module_catalog(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_organization_module_catalog(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_organization_module_catalog(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.super_admin_set_organization_module(
  p_organization_id uuid,
  p_feature_key text,
  p_enabled boolean,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_feature_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORGANIZATION_NOT_FOUND');
  END IF;

  SELECT f.id
    INTO v_feature_id
  FROM public.features f
  WHERE f.key = p_feature_key
    AND f.is_active = true;

  IF v_feature_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'FEATURE_NOT_FOUND');
  END IF;

  INSERT INTO public.organization_feature_overrides (
    organization_id,
    feature_id,
    enabled,
    reason,
    updated_by,
    updated_at
  )
  VALUES (
    p_organization_id,
    v_feature_id,
    p_enabled,
    NULLIF(btrim(COALESCE(p_reason, '')), ''),
    auth.uid(),
    now()
  )
  ON CONFLICT (organization_id, feature_id) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      reason = EXCLUDED.reason,
      updated_by = EXCLUDED.updated_by,
      updated_at = now();

  PERFORM public.log_audit_action(
    NULL::uuid,
    CASE WHEN p_enabled THEN 'enable_organization_module' ELSE 'disable_organization_module' END,
    'organization_feature_overrides',
    p_organization_id,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'feature_key', p_feature_key,
      'enabled', p_enabled,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', p_organization_id,
    'feature_key', p_feature_key,
    'enabled', p_enabled
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.super_admin_set_organization_module(uuid, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.super_admin_set_organization_module(uuid, text, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.super_admin_set_organization_module(uuid, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_set_organization_module(uuid, text, boolean, text) TO service_role;
