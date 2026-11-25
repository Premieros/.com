-- Prevent the direct sales UPDATE path from changing an approved invoice's
-- discount without the same discount permission already required on INSERT.
-- This migration is code-only until separately reviewed and deployed.
--
-- Other invoice values (total, paid_amount, tax etc.) require a broader
-- authorized-financial-mutation audit; this narrow change does not cover them.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.guard_sale_discount_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
     AND COALESCE(NEW.discount_amount, 0) > 0
     AND NOT public.is_pos_admin()
     AND NOT public.can_permission('pos.discount')
  THEN
    RAISE EXCEPTION 'DISCOUNT_NOT_ALLOWED';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_sale_discount_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sales_discount_update_guard ON public.sales;
CREATE TRIGGER trg_sales_discount_update_guard
BEFORE UPDATE OF discount_amount ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.guard_sale_discount_update();
