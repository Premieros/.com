-- Read-only opening inventory accounting preview. The existing
-- seed_opening_balances RPC remains the sole posting authority.
CREATE OR REPLACE FUNCTION public.preview_opening_balances(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $fn$
DECLARE
  v_finished numeric(14,2):=0;
  v_raw numeric(14,2):=0;
  v_entry record;
BEGIN
  IF auth.uid() IS NULL OR p_branch_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_OR_BRANCH_REQUIRED');
  END IF;
  IF NOT public.user_may_access_branch(p_branch_id)
     OR NOT (public.is_pos_admin() OR public.can_permission('accounts.view')) THEN
    RETURN jsonb_build_object('success',false,'error','NOT_ALLOWED');
  END IF;

  SELECT round(COALESCE(SUM(quantity*unit_cost),0),2) INTO v_finished
  FROM public.inventory_batches WHERE branch_id=p_branch_id;
  SELECT round(COALESCE(SUM(quantity*unit_cost),0),2) INTO v_raw
  FROM public.raw_material_batches WHERE branch_id=p_branch_id;

  SELECT id,entry_number,entry_date
    INTO v_entry
  FROM public.journal_entries
  WHERE branch_id=p_branch_id AND reference_type='opening'
  ORDER BY created_at LIMIT 1;

  RETURN jsonb_build_object(
    'success',true,'branch_id',p_branch_id,
    'finished',v_finished,'raw',v_raw,
    'total',round(v_finished+v_raw,2),
    'has_opening',v_entry.id IS NOT NULL,
    'can_post',v_entry.id IS NULL AND (v_finished+v_raw)>0,
    'opening_entry',CASE WHEN v_entry.id IS NOT NULL THEN
      jsonb_build_object('id',v_entry.id,'entry_number',v_entry.entry_number,
        'entry_date',v_entry.entry_date)
      ELSE NULL END
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.preview_opening_balances(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.preview_opening_balances(uuid) TO authenticated;
COMMENT ON FUNCTION public.preview_opening_balances(uuid)
IS 'Read-only branch-scoped preview of finished/raw inventory opening journal amounts. Never inserts or updates financial records.';
