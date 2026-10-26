-- PremierOS .com FIFO retirement acceptance gate.
-- Must return no rows before approving the FINAL FIFO removal cutover.
-- Run against Supabase project hvqlkapynjfjikqithvd.
SELECT p.oid::regprocedure AS remaining_fifo_function
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','private')
 AND (p.proname ILIKE '%fifo%' OR p.prosrc ILIKE '%_raw_remove_fifo%'
      OR p.prosrc ILIKE '%raw_fifo_debts%')
ORDER BY 1;

-- Critical runtime FIFO references should be zero:
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
 WHERE ns.nspname='public' AND p.proname <> '_raw_remove_fifo'
   AND p.prosrc ILIKE '%_raw_remove_fifo%';
 IF n<>0 THEN
  RAISE EXCEPTION 'FIFO_CUTOVER_NOT_COMPLETE: % operational SQL functions still call FIFO', n;
 END IF;
END $$;

-- Additional required checks outside SQL:
-- application/Edge Function references, posted COGS/journal reconciliation,
-- branch/warehouse isolation, idempotent sale/void/return, production,
-- stock count, transfer, purchase receipts, concurrency and load tests.
