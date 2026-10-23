-- ============================================================================
-- Migration: 20261023231000_verify_non_fifo_cutover_integrity.sql
-- Description: Integration verification script for unified non-FIFO movement engine.
-- Scope: Premieros/.com, Supabase hvqlkapynjfjikqithvd ONLY.
-- ============================================================================

DO $$
DECLARE
    v_proc_count integer;
BEGIN
    -- Check that no functions inside public or private schema call _raw_remove_fifo except the wrapper redirect itself
    SELECT count(*) INTO v_proc_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private')
      AND p.proname <> '_raw_remove_fifo'
      AND p.prosrc ILIKE '%_raw_remove_fifo%';

    IF v_proc_count <> 0 THEN
        RAISE EXCEPTION 'NON_FIFO_CUTOVER_FAILED: % functions still contain _raw_remove_fifo references', v_proc_count;
    END IF;
END $$;
