-- Organization business profiles and atomic Super Admin provisioning.
-- Target: Premieros/.com only.
-- Creates a complete runnable tenant shell while preserving Permission-First and RLS.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS business_type text NOT NULL DEFAULT 'restaurant',
  ADD COLUMN IF NOT EXISTS business_profile jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_business_type_check'
      AND conrelid = 'public.organizations'::regclass
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_business_type_check
      CHECK (business_type IN (
        'restaurant',
        'food_manufacturing',
        'pharmacy',
        'car_showroom',
        'tourism',
        'retail',
        'services',
        'custom'
      ));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.super_admin_create_organization_from_profile(
  p_name text,
  p_business_type text,
  p_branch_name text,
  p_enabled_modules text[],
  p_business_profile jsonb,
  p_owner_name text,
  p_owner_email text,
  p_owner_password text,
  p_phone text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_currency text DEFAULT 'EGP',
  p_tax_enabled boolean DEFAULT true,
  p_tax_rate numeric DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_org_id uuid := gen_random_uuid();
  v_branch_id uuid;
  v_warehouse_id uuid;
  v_user_id uuid;
  v_user_result jsonb;
  v_slug text;
  v_type text := lower(btrim(COALESCE(p_business_type, '')));
  v_name text := btrim(COALESCE(p_name, ''));
  v_branch_name text := btrim(COALESCE(p_branch_name, ''));
  v_email text := lower(btrim(COALESCE(p_owner_email, '')));
  v_module_keys constant text[] := ARRAY[
    'pos','catalog','inventory','purchases','customers','suppliers','expenses',
    'shift_management','accounting','costing','reports','advanced_reports',
    'branch_management','employees','advanced_permissions','approvals',
    'audit_logs','data_exchange','kds'
  ];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;

  IF v_name = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORGANIZATION_NAME_REQUIRED');
  END IF;

  IF v_branch_name = '' THEN
    v_branch_name := v_name;
  END IF;

  IF v_type <> ALL(ARRAY[
    'restaurant','food_manufacturing','pharmacy','car_showroom',
    'tourism','retail','services','custom'
  ]) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_BUSINESS_TYPE');
  END IF;

  IF v_email = '' OR v_email !~ '@' OR v_email !~ '\\.' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_OWNER_EMAIL');
  END IF;

  IF COALESCE(length(p_owner_password), 0) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'WEAK_OWNER_PASSWORD');
  END IF;

  IF btrim(COALESCE(p_owner_name, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'OWNER_NAME_REQUIRED');
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email)
     OR EXISTS (SELECT 1 FROM public.users WHERE lower(email) = v_email) THEN
    RETURN jsonb_build_object('success', false, 'error', 'OWNER_EMAIL_TAKEN');
  END IF;

  v_slug := 'org-' || replace(v_org_id::text, '-', '');

  INSERT INTO public.organizations (
    id, name, slug, is_active, business_type, business_profile
  )
  VALUES (
    v_org_id,
    v_name,
    v_slug,
    true,
    v_type,
    COALESCE(p_business_profile, '{}'::jsonb)
  );

  INSERT INTO public.branches (
    name, name_en, address, phone, is_active, organization_id
  )
  VALUES (
    v_branch_name, v_branch_name, p_address, p_phone, true, v_org_id
  )
  RETURNING id INTO v_branch_id;

  INSERT INTO public.warehouses (name, branch_id, is_active)
  VALUES (v_branch_name || ' - Main', v_branch_id, true)
  RETURNING id INTO v_warehouse_id;

  INSERT INTO public.branch_settings (
    branch_id, tax_rate, tax_enabled, currency, low_stock_threshold
  )
  VALUES (
    v_branch_id,
    GREATEST(COALESCE(p_tax_rate, 0), 0),
    COALESCE(p_tax_enabled, false),
    COALESCE(NULLIF(btrim(p_currency), ''), 'EGP'),
    10
  );

  INSERT INTO public.branch_subscriptions (
    branch_id, status, trial_starts_at, trial_ends_at
  )
  VALUES (
    v_branch_id, 'trial', now(), now() + interval '14 days'
  );

  -- Explicitly stamp every business-facing module for deterministic presets.
  INSERT INTO public.organization_feature_overrides (
    organization_id, feature_id, enabled, reason, updated_by, updated_at
  )
  SELECT
    v_org_id,
    f.id,
    f.key = ANY(COALESCE(p_enabled_modules, ARRAY[]::text[])),
    'business_profile:' || v_type,
    auth.uid(),
    now()
  FROM public.features f
  WHERE f.is_active = true
    AND f.key = ANY(v_module_keys)
  ON CONFLICT (organization_id, feature_id) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      reason = EXCLUDED.reason,
      updated_by = EXCLUDED.updated_by,
      updated_at = now();

  PERFORM set_config('app.register_branch', 'on', true);
  v_user_result := public.create_user(
    v_email,
    p_owner_password,
    btrim(p_owner_name),
    'owner',
    v_branch_id,
    true,
    NULL
  );
  PERFORM set_config('app.register_branch', 'off', true);

  IF NOT COALESCE((v_user_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'OWNER_CREATE_FAILED: %', COALESCE(v_user_result->>'error', 'UNKNOWN');
  END IF;

  v_user_id := (v_user_result->>'user_id')::uuid;

  INSERT INTO public.organization_members (
    organization_id, user_id, membership_role, is_active
  )
  VALUES (
    v_org_id, v_user_id, 'owner', true
  );

  PERFORM public.log_audit_action(
    v_branch_id,
    'create_organization_from_profile',
    'organizations',
    v_org_id,
    jsonb_build_object(
      'organization_id', v_org_id,
      'business_type', v_type,
      'branch_id', v_branch_id,
      'owner_user_id', v_user_id,
      'enabled_modules', COALESCE(p_enabled_modules, ARRAY[]::text[])
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_org_id,
    'branch_id', v_branch_id,
    'warehouse_id', v_warehouse_id,
    'owner_user_id', v_user_id,
    'business_type', v_type,
    'trial_days', 14
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'ORGANIZATION_CREATE_FAILED',
    'detail', SQLERRM
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.super_admin_create_organization_from_profile(
  text,text,text,text[],jsonb,text,text,text,text,text,text,boolean,numeric
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.super_admin_create_organization_from_profile(
  text,text,text,text[],jsonb,text,text,text,text,text,text,boolean,numeric
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
