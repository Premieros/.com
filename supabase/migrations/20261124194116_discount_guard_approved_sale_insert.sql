-- The sale core writes the authoritative discount in the initial INSERT.
-- Use the locked settlement capability already established by the sale RPCs.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.guard_sale_discount()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF NEW.discount_amount > 0
     AND NOT public.is_pos_admin()
     AND NOT public.can_permission('pos.discount')
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM private.discount_settlement_context c
      JOIN public.approval_requests a ON a.id = c.approval_id
      WHERE c.transaction_id = txid_current()
        AND c.actor_id = auth.uid()
        AND c.branch_id = NEW.branch_id
        AND c.invoice_number = NEW.invoice_number
        AND c.discount_amount = NEW.discount_amount
        AND a.requester_id = c.actor_id
        AND a.branch_id = c.branch_id
        AND a.action_type = 'discount'
        AND a.status = 'approved'
        AND a.expires_at > now()
    ) THEN
      RAISE EXCEPTION 'DISCOUNT_NOT_ALLOWED';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;

REVOKE ALL ON FUNCTION public.guard_sale_discount() FROM PUBLIC, anon, authenticated;
