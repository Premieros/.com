-- PREMIER GO-LIVE 2026-11-12: new branch defaults only, no existing branch update.
-- Every branch may later configure its own start/end schedule through settings.
-- Do not replay this into production without separate release authorization.
CREATE OR REPLACE FUNCTION public.create_organization_branch(p_organization_id uuid, p_name text, p_name_en text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch_id uuid;
  v_warehouse_id uuid;
  v_global_tax numeric(5,2);
  v_global_tax_enabled boolean;
  v_global_currency text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.is_pos_admin() THEN
    IF NOT public.can_permission('branches.manage')
       OR NOT public.user_can_access_organization(p_organization_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
    END IF;
  END IF;

  IF btrim(COALESCE(p_name, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_BRANCH_NAME');
  END IF;

  -- Mark this exact caller + organization BEFORE the branch insert. Branch
  -- AFTER INSERT triggers seed guarded rows immediately, so a branch-id marker
  -- created after INSERT would be too late. This marker is private and is
  -- removed before return; any exception rolls it back with the transaction.
  INSERT INTO public.work_authorization_branch_bootstrap (user_id, organization_id)
  VALUES (auth.uid(), p_organization_id);

  INSERT INTO public.branches (name, name_en, address, phone, is_active, organization_id)
  VALUES (p_name, p_name_en, p_address, p_phone, true, p_organization_id)
  RETURNING id INTO v_branch_id;

  -- Preserve the existing creator access grant after the branch now exists.
  INSERT INTO public.user_branch_access (user_id, branch_id)
  VALUES (auth.uid(), v_branch_id)
  ON CONFLICT (user_id, branch_id) DO NOTHING;

  INSERT INTO public.warehouses (name, branch_id, is_active)
  VALUES (p_name || ' - Main', v_branch_id, true)
  RETURNING id INTO v_warehouse_id;

  SELECT COALESCE(tax_rate, 15), COALESCE(tax_enabled, true), COALESCE(currency, 'EGP')
  INTO v_global_tax, v_global_tax_enabled, v_global_currency
  FROM public.settings
  ORDER BY id
  LIMIT 1;

  -- Defaults only for newly created branches. Existing branches are untouched.
  -- Local Africa/Cairo workday: 10:00 → 02:00 the next calendar day.
  INSERT INTO public.branch_settings (
    branch_id, tax_rate, tax_enabled, currency, low_stock_threshold,
    business_day_mode, business_day_start, business_day_end,
    auto_close_shift_at_day_end
  )
  VALUES (
    v_branch_id, v_global_tax, v_global_tax_enabled, v_global_currency, 10,
    'fixed_time', '10:00'::time, '02:00'::time, true
  );

  INSERT INTO public.branch_subscriptions (branch_id, status, trial_starts_at, trial_ends_at)
  VALUES (v_branch_id, 'trial', now(), now() + interval '14 days');

  DELETE FROM public.work_authorization_branch_bootstrap
  WHERE user_id = auth.uid()
    AND organization_id = p_organization_id;

  RETURN jsonb_build_object(
    'success', true,
    'branch_id', v_branch_id,
    'warehouse_id', v_warehouse_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'BRANCH_CREATE_FAILED',
    'detail', SQLERRM
  );
END;
$function$;

-- Preserve previous public routine's existing owner, argument signature,
-- SECURITY DEFINER semantics and privileges through CREATE OR REPLACE.
