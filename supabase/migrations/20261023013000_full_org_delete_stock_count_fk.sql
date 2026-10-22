-- Correct stock-count / raw-material / warehouse FK deletion ordering.
-- Deployment changes the guarded RPC only and does not delete tenant data.
-- Confirmed Super Admin deletion still runs atomically via the private queue.
CREATE OR REPLACE FUNCTION public.super_admin_delete_organization(p_organization_id uuid, p_confirm_name text, p_confirm_phrase text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_org public.organizations%ROWTYPE;
  v_preflight jsonb;
  v_branches uuid[];
  v_users uuid[];
  v_user_count integer;
  v_auth_count integer;
  v_nbranches integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success',false,'error','SUPER_ADMIN_REQUIRED');
  END IF;
  IF p_organization_id IS NULL OR p_confirm_phrase IS DISTINCT FROM 'DELETE' THEN
    RETURN jsonb_build_object('success',false,'error','CONFIRMATION_REQUIRED');
  END IF;
  SELECT * INTO v_org FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','ORGANIZATION_NOT_FOUND'); END IF;
  IF v_org.name IS DISTINCT FROM p_confirm_name THEN
    RETURN jsonb_build_object('success',false,'error','ORGANIZATION_NAME_MISMATCH');
  END IF;

  -- Snapshot and lock tenant scope to avoid races with tenant writers.
  SELECT COALESCE(array_agg(id),'{}'::uuid[]) INTO v_branches
    FROM public.branches WHERE organization_id=p_organization_id;
  PERFORM 1 FROM public.branches WHERE id=ANY(v_branches) FOR UPDATE;
  SELECT COALESCE(array_agg(id),'{}'::uuid[]) INTO v_users
    FROM public.users WHERE branch_id=ANY(v_branches) AND role<>'super_admin';
  PERFORM 1 FROM public.users WHERE id=ANY(v_users) FOR UPDATE;

  v_preflight:=private.organization_full_deletion_preflight(p_organization_id);
  IF NOT COALESCE((v_preflight->>'eligible')::boolean,false) THEN
    RETURN jsonb_build_object('success',false,'error','CROSS_ORGANIZATION_DEPENDENCIES','preview',v_preflight);
  END IF;
  v_nbranches:=(v_preflight->>'branches')::integer;
  v_user_count:=(v_preflight->>'users')::integer;
  PERFORM set_config('app.full_org_purge_branch_ids',array_to_string(v_branches,','),true);
  PERFORM set_config('app.full_org_purge_org_id',p_organization_id::text,true);

  -- Remove REFERENCES NO ACTION / RESTRICT that would block normal
  -- ON DELETE CASCADE from the selected organization. All predicates are
  -- organization- or branch-scoped and never include global Super Admin IDs.
  DELETE FROM private.erp_domain_event_receipts_v2
    WHERE organization_id=p_organization_id OR branch_id=ANY(v_branches);
  DELETE FROM private.erp_domain_outbox_v2
    WHERE organization_id=p_organization_id OR branch_id=ANY(v_branches);
  DELETE FROM private.organization_journal_line_evidence_v2
    WHERE organization_id=p_organization_id OR branch_id=ANY(v_branches);
  DELETE FROM private.organization_account_sync_requests_v2
    WHERE organization_id=p_organization_id OR branch_id=ANY(v_branches);
  DELETE FROM private.pos_sale_idempotency WHERE branch_id=ANY(v_branches);
  DELETE FROM public.raw_fifo_orphan_sale_cogs_adjustments WHERE branch_id=ANY(v_branches);
  DELETE FROM public.raw_opening_cost_repair_plan WHERE branch_id=ANY(v_branches);
  DELETE FROM public.raw_opening_cost_repair_runs WHERE branch_id=ANY(v_branches);
  DELETE FROM public.employee_receivable_entries WHERE branch_id=ANY(v_branches);
  DELETE FROM public.sale_print_events WHERE branch_id=ANY(v_branches);
  DELETE FROM public.warehouse_transfers WHERE branch_id=ANY(v_branches);
  -- Empty/sent kitchen references are tenant-owned and must be removed
  -- before the orders cascade through sent-item protection checks.
  DELETE FROM public.order_kitchen_inventory_events WHERE branch_id=ANY(v_branches);
  DELETE FROM public.order_kitchen_sends WHERE branch_id=ANY(v_branches);
  DELETE FROM public.order_kitchen_voids WHERE branch_id=ANY(v_branches);
  DELETE FROM public.approval_requests WHERE branch_id=ANY(v_branches);
  DELETE FROM public.support_conversations WHERE organization_id=p_organization_id;

  -- Scoped child records must be removed before users/customers are cascaded:
  -- PostgreSQL RESTRICT prevents relying on branch CASCADE for every table.
  -- Delete tenant sales BEFORE their employee customers. Otherwise the
  -- sales_customer_id_fkey (ON DELETE SET NULL) updates historical credit
  -- sales and the normal CREDIT_EMPLOYEE_ONLY trigger rightly rejects it.
  -- This removes the sales themselves; no sale/payment validation is bypassed.
  -- Sale child RESTRICT/NO ACTION dependencies were removed above.
  DELETE FROM public.sales WHERE branch_id=ANY(v_branches);
  DELETE FROM public.customers WHERE branch_id=ANY(v_branches);

  -- Cascade handles all other scoped children of orgs and branches.
  -- Remaining FK checks protect any missed/new dependency.
  -- PostgreSQL RESTRICT/NO ACTION foreign keys can reject branch cascades
  -- if accounts happen to be deleted before journal lines / expense records.
  -- Delete dependent records first. All predicates target only locked branches.
  DELETE FROM public.expense_routing_rules WHERE branch_id=ANY(v_branches);
  DELETE FROM public.expenses WHERE branch_id=ANY(v_branches);
  DELETE FROM public.journal_entry_lines
    WHERE journal_entry_id IN (
      SELECT id FROM public.journal_entries WHERE branch_id=ANY(v_branches)
    );
  -- Reversals may point to entries in the same organization with a RESTRICT FK.
  -- Break only internal reversal links before deleting all tenant journals.
  UPDATE public.journal_entries SET reversal_of=NULL
    WHERE branch_id=ANY(v_branches) AND reversal_of IS NOT NULL;
  DELETE FROM public.journal_entries WHERE branch_id=ANY(v_branches);

  -- A FIFO settlement must never point across tenant boundaries: block
  -- instead of deleting or updating records owned by another organization.
  IF EXISTS (
    SELECT 1 FROM public.raw_fifo_settlements s
    JOIN public.raw_fifo_debts d ON d.id=s.debt_id
    JOIN public.inventory_ledger r ON r.id=s.receipt_ledger_id
    WHERE (d.branch_id=ANY(v_branches)) IS DISTINCT FROM
          (r.branch_id=ANY(v_branches))
  ) THEN
    RETURN jsonb_build_object('success',false,
      'error','CROSS_ORGANIZATION_FIFO_SETTLEMENT');
  END IF;

  -- The raw FIFO model has RESTRICT foreign keys to inventory_ledger and
  -- raw_fifo_debts. Those ledgers cascade from the target branches, so
  -- remove their tenant-owned FIFO derivatives FIRST to preserve FK order.
  -- Cross-tenant receipt/debt links are detected before this step.
  DELETE FROM public.raw_fifo_debt_rebase_settlement_snapshots s
  USING public.raw_fifo_debts d
  WHERE s.debt_id=d.id AND d.branch_id=ANY(v_branches);
  DELETE FROM public.raw_fifo_debt_rebase_snapshots s
  USING public.raw_fifo_debts d
  WHERE s.debt_id=d.id AND d.branch_id=ANY(v_branches);
  DELETE FROM public.raw_fifo_settlements s
  USING public.raw_fifo_debts d
  WHERE s.debt_id=d.id AND d.branch_id=ANY(v_branches);
  DELETE FROM public.raw_fifo_backfill_allocations a
  WHERE EXISTS (
    SELECT 1 FROM public.inventory_ledger r
    WHERE (r.id=a.receipt_ledger_id OR r.id=a.consumption_ledger_id)
      AND r.branch_id=ANY(v_branches)
  );
  DELETE FROM public.raw_fifo_backfill_plan
    WHERE branch_id=ANY(v_branches);
  DELETE FROM public.raw_fifo_debts
    WHERE branch_id=ANY(v_branches);
  DELETE FROM public.raw_fifo_backfill_runs
    WHERE branch_id=ANY(v_branches);

  -- Stock-count lines are RESTRICT references to products and raw_materials,
  -- and their headers RESTRICT references to warehouses. Deleting a branch
  -- before its stock count records will fail FK 23503; remove both first.
  -- Never delete lines from a different organization's count even when it
  -- incorrectly references a material owned by this tenant.
  IF EXISTS (
    SELECT 1 FROM public.stock_count_items i
    JOIN public.stock_counts sc ON sc.id=i.stock_count_id
    JOIN public.raw_materials rm ON rm.id=i.raw_material_id
    WHERE rm.branch_id=ANY(v_branches)
      AND sc.branch_id<>ALL(v_branches)
  ) THEN
    RETURN jsonb_build_object('success',false,'error',
      'CROSS_ORGANIZATION_STOCK_COUNT_REFERENCE');
  END IF;
  DELETE FROM public.stock_count_items i
  USING public.stock_counts sc
  WHERE i.stock_count_id=sc.id AND sc.branch_id=ANY(v_branches);
  DELETE FROM public.stock_counts WHERE branch_id=ANY(v_branches);

  DELETE FROM public.organizations WHERE id=p_organization_id;

  -- Deleting the org cascades only its local application user profiles.
  -- Remove their login identities; GLOBAL Super Admins are excluded.
  DELETE FROM auth.sessions WHERE user_id=ANY(v_users);
  DELETE FROM auth.identities WHERE user_id=ANY(v_users);
  DELETE FROM auth.users WHERE id=ANY(v_users);
  GET DIAGNOSTICS v_auth_count=ROW_COUNT;

  INSERT INTO private.organization_deletion_receipts
    (organization_id,organization_name,branch_count,
     application_user_count,auth_accounts_deleted,requested_by)
  VALUES (p_organization_id,v_org.name,v_nbranches,v_user_count,v_auth_count,auth.uid());

  PERFORM set_config('app.full_org_purge_org_id','',true);
  PERFORM set_config('app.full_org_purge_branch_ids','',true);
  RETURN jsonb_build_object('success',true,'deleted',true,
    'organization_id',p_organization_id,'branches',v_nbranches,
    'users',v_user_count,'auth_accounts_deleted',v_auth_count,
    'super_admin_accounts_preserved',true);
EXCEPTION WHEN OTHERS THEN
  -- Entire function body runs in a subtransaction. Roll back all deletes,
  -- surface a generic error, and never leave a half-deleted organization.
  RAISE WARNING 'Full organization delete aborted (sqlstate: %, reason: %)',SQLSTATE,SQLERRM;
  RETURN jsonb_build_object('success',false,'error','DELETE_BLOCKED_ATOMICALLY');
END;
$function$;
