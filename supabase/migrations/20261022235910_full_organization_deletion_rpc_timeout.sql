-- The full organization deletion RPC processes a large transactional tenant
-- (thousands of accounting, inventory and sales rows). Supabase's authenticated
-- role times out statements at 8 seconds, even though the underlying deletion
-- checks and database integrity protections are valid. The REST API supports
-- function-local timeouts up to 60 seconds.
--
-- Scope the extension ONLY to this Super Admin-protected RPC. Never raise
-- the timeout for the entire authenticated role or all POS transactions.
-- Deploying this migration does not delete any organization or data.
ALTER FUNCTION public.super_admin_delete_organization(uuid, text, text)
  SET statement_timeout TO '60s';

COMMENT ON FUNCTION public.super_admin_delete_organization(uuid,text,text)
IS 'Super Admin only. Confirmed, atomic organization purge with tenant isolation. Extended 60s timeout for high-volume transactional records; all normal POS endpoints retain role timeouts.';
