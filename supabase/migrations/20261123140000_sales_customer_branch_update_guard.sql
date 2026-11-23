-- Draft security migration; applied by disposable CI migration replay only.
-- Protect sales metadata edits from cross-branch customer re-assignment.
-- Existing FK only validates customers(id), not (id, branch_id).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.guard_sale_customer_branch_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     AND NEW.customer_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.customers c
       WHERE c.id = NEW.customer_id AND c.branch_id = NEW.branch_id
     )
  THEN
    RAISE EXCEPTION 'SALE_CUSTOMER_BRANCH_MISMATCH';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_sale_customer_branch_update()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sales_customer_branch_update_guard ON public.sales;
CREATE TRIGGER trg_sales_customer_branch_update_guard
BEFORE UPDATE OF customer_id ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.guard_sale_customer_branch_update();
