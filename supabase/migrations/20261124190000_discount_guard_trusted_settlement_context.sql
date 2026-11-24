-- Draft: validate on disposable CI only.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- A transaction-local capability backed by a private relation, not a client
-- settable GUC. Only the already-authorized settlement functions write it.
-- It is removed immediately after the core call, including false results.
CREATE TABLE private.discount_settlement_context (
  transaction_id bigint NOT NULL,
  approval_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  invoice_number text NOT NULL,
  discount_amount numeric NOT NULL CHECK (discount_amount > 0),
  PRIMARY KEY (transaction_id, approval_id)
);
ALTER TABLE private.discount_settlement_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.discount_settlement_context FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_sale_discount_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $guard$
BEGIN
  IF NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
     AND COALESCE(NEW.discount_amount, 0) > 0
     AND NOT public.is_pos_admin()
     AND NOT public.can_permission('pos.discount')
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM private.discount_settlement_context c
      JOIN public.approval_requests a ON a.id=c.approval_id
      WHERE c.transaction_id=txid_current()
        AND c.actor_id=auth.uid()
        AND c.branch_id=NEW.branch_id AND c.branch_id=OLD.branch_id
        AND c.invoice_number=NEW.invoice_number AND c.invoice_number=OLD.invoice_number
        AND c.discount_amount=NEW.discount_amount
        AND a.requester_id=c.actor_id AND a.branch_id=c.branch_id
        AND a.action_type='discount' AND a.status='approved' AND a.expires_at>now()
    ) THEN
      RAISE EXCEPTION 'DISCOUNT_NOT_ALLOWED';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION public.guard_sale_discount_update() FROM PUBLIC, anon, authenticated;

DO $migration$
DECLARE
  target regprocedure;
  definition text;
  core_anchor text;
  cleanup_anchor constant text := 'PERFORM set_config(''app.delivery_fee_order_id'','''',true);';
  enter_context constant text := $enter$
    IF v_req_id IS NOT NULL THEN
      INSERT INTO private.discount_settlement_context(
        transaction_id, approval_id, actor_id, branch_id, invoice_number, discount_amount
      ) VALUES(txid_current(), v_req_id, auth.uid(), p_branch_id, p_invoice_number, v_header_discount);
    END IF;
$enter$;
  leave_context constant text := $leave$
    IF v_req_id IS NOT NULL THEN
      DELETE FROM private.discount_settlement_context
      WHERE transaction_id=txid_current() AND approval_id=v_req_id;
    END IF;
$leave$;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'public.process_sale(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure,
    'public.process_sale_split(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure
  ] LOOP
    definition := pg_get_functiondef(target);
    core_anchor := CASE WHEN target::text LIKE 'process_sale_split(%' OR target::text LIKE 'public.process_sale_split(%'
      THEN 'v_core := public._process_sale_core(' ELSE 'v_result := public._process_sale_core(' END;
    IF strpos(definition,core_anchor)=0 OR strpos(definition,cleanup_anchor)=0
       OR strpos(definition,'FOR UPDATE')=0 OR strpos(definition,'APPROVAL_CONSUMED')=0 THEN
      RAISE EXCEPTION 'Expected locked settlement contract missing in %',target;
    END IF;
    definition := replace(definition,core_anchor,enter_context || core_anchor);
    EXECUTE replace(definition,cleanup_anchor,leave_context || cleanup_anchor);
  END LOOP;
END;
$migration$;
