-- REVIEW ONLY. Never run on production without explicit release approval.
-- Disable new quantity commands while retaining all split rows, KDS snapshots,
-- inventory effects, transfer provenance and audit/idempotency records.
-- Existing three-argument whole-row transfers remain available.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $verify$
BEGIN
 IF to_regprocedure('public.transfer_order_items_to_table(uuid,uuid[],uuid,jsonb)') IS NULL
    OR to_regclass('private.pos_partial_transfer_control') IS NULL THEN
   RAISE EXCEPTION 'PARTIAL_TRANSFER_DISABLE_BASELINE_MISSING';
 END IF;
END $verify$;
UPDATE private.pos_partial_transfer_control SET enabled=false WHERE singleton;
COMMIT;
