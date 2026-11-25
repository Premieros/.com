-- LIMIT DIRECT SALES MUTATIONS: draft migration for CI / review, not production.
-- Financial postings, refunds, payment/status adjustments and archiving must go
-- through authoritative SECURITY DEFINER RPCs, not user-supplied UPDATE payloads.
-- Validated against the 2026-11-23 deployed schema and current source.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- This existing trigger links settled kitchen inventory events to the source
-- sale. It must retain its ability to update source_order_id after direct
-- column UPDATE privileges are narrowed. Its existing body checks the sale id,
-- branch id, and only sets an empty/identical link.
ALTER FUNCTION public.sync_sale_source_order_from_kitchen_event()
  SECURITY DEFINER;
ALTER FUNCTION public.sync_sale_source_order_from_kitchen_event()
  SET search_path = 'public', 'pg_temp';
REVOKE ALL ON FUNCTION public.sync_sale_source_order_from_kitchen_event()
  FROM PUBLIC, anon, authenticated;

-- RLS guards which rows are accessible; column grants guard which fields a
-- branch-authorized user is allowed to mutate over PostgREST.
REVOKE UPDATE ON TABLE public.sales FROM authenticated;
GRANT UPDATE (customer_id, notes) ON TABLE public.sales TO authenticated;

-- RLS does not protect TRUNCATE. There is no legitimate UI workflow that
-- empties all sales records.
REVOKE TRUNCATE ON TABLE public.sales FROM authenticated;
REVOKE TRUNCATE ON TABLE public.sales FROM anon;

-- Destructive deletion is not a supported financial workflow. Full returns are
-- handled by process_refund, while old returned invoices are archived through
-- archive_returned_sale. Prevent even branch managers from bypassing those.
REVOKE DELETE ON TABLE public.sales FROM authenticated;
REVOKE DELETE ON TABLE public.sales FROM anon;

-- Sale-line RLS already blocks direct deletion, but TRUNCATE bypasses RLS.
REVOKE TRUNCATE ON TABLE public.sale_items FROM authenticated;
REVOKE TRUNCATE ON TABLE public.sale_items FROM anon;

-- Protected SECURITY DEFINER business RPCs retain their owner privileges.
-- Test refund, settlement, payment-method change, archive and event sync in
-- disposable CI before applying to any production project.
