-- Retire historical FIFO debt rebase helper functions with no SQL callers.
-- Keep operational FIFO functions and historical accounting records until a safe cutover.
DROP FUNCTION IF EXISTS public._raw_fifo_rebase_historical_debt_state(uuid) RESTRICT;
DROP FUNCTION IF EXISTS public._raw_fifo_restore_rebased_debt_state(uuid) RESTRICT;
