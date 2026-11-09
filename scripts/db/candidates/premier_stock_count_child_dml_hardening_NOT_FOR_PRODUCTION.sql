-- Premier production hardening candidate: isolated CI validation REQUIRED.
-- Revoke direct stock-count DML from the authenticated Data API role and
-- restrict line SELECT via already-protected parent stock_counts RLS.
-- Official create/submit/approve/reject/apply stock-count RPCs run as
-- postgres SECURITY DEFINER and retain the controlled write workflow.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='stock_counts'
      AND policyname='premier_stock_counts_branch_select_gate'
      AND permissive='RESTRICTIVE'
  ) THEN
    RAISE EXCEPTION 'STOCK_COUNT_PARENT_BRANCH_GATE_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='stock_count_items'
      AND policyname='auth_stock_count_items_select' AND qual='true'
  ) THEN
    RAISE EXCEPTION 'STOCK_COUNT_LINE_SELECT_BASELINE_DRIFT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='stock_count_items'
      AND policyname='premier_stock_count_items_parent_visibility_gate'
  ) THEN
    RAISE EXCEPTION 'STOCK_COUNT_LINE_GATE_ALREADY_APPLIED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.stock_count_items'::regclass
      AND conname='stock_count_items_stock_count_id_fkey'
  ) THEN
    RAISE EXCEPTION 'STOCK_COUNT_LINE_PARENT_FK_MISSING';
  END IF;
END $preflight$;

CREATE POLICY premier_stock_count_items_parent_visibility_gate
 ON public.stock_count_items AS RESTRICTIVE FOR SELECT TO authenticated
 USING (
   EXISTS (
     SELECT 1 FROM public.stock_counts sc
     WHERE sc.id=stock_count_items.stock_count_id
   )
 );

-- Authentication alone is insufficient to mutate counts; rely exclusively
-- on the validated SECURITY DEFINER RPC workflow for mutations.
REVOKE INSERT, UPDATE, DELETE
 ON TABLE public.stock_counts,public.stock_count_items
 FROM authenticated;

DO $postcheck$
BEGIN
 IF has_table_privilege('authenticated','public.stock_counts','INSERT')
   OR has_table_privilege('authenticated','public.stock_counts','UPDATE')
   OR has_table_privilege('authenticated','public.stock_counts','DELETE')
   OR has_table_privilege('authenticated','public.stock_count_items','INSERT')
   OR has_table_privilege('authenticated','public.stock_count_items','UPDATE')
   OR has_table_privilege('authenticated','public.stock_count_items','DELETE')
 THEN RAISE EXCEPTION 'STOCK_COUNT_DIRECT_WRITE_GRANT_REMAINED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies
  WHERE schemaname='public' AND tablename='stock_count_items'
    AND policyname='premier_stock_count_items_parent_visibility_gate'
    AND permissive='RESTRICTIVE')
 THEN RAISE EXCEPTION 'STOCK_COUNT_LINE_RLS_GATE_MISSING'; END IF;
END $postcheck$;
COMMIT;
