-- Premier refunds must not commit an earlier sale_item mutation when a
-- later inventory restoration helper responds with success=false.
-- Reconstruct the deployed canonical core with only guarded failure exits
-- changed. No recalculation of COGS, journal lines or historical stock prices.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';
DO $patch$
DECLARE
  v_def text;
  v_old_handler text := E'  EXCEPTION WHEN OTHERS THEN\n    RETURN jsonb_build_object(\'success\', false, \'error\', \'TRANSACTION_FAILED\', \'detail\', SQLERRM);';
  v_new_handler text := E'  EXCEPTION\n    WHEN SQLSTATE \'P0001\' THEN\n      IF SQLERRM = \'PREMIER_REFUND_CORE_ABORT\' AND v_failure IS NOT NULL THEN\n        RETURN v_failure;\n      END IF;\n      RETURN jsonb_build_object(\'success\', false, \'error\', \'TRANSACTION_FAILED\', \'detail\', SQLERRM);\n    WHEN OTHERS THEN\n      RETURN jsonb_build_object(\'success\', false, \'error\', \'TRANSACTION_FAILED\', \'detail\', SQLERRM);';
BEGIN
  IF to_regprocedure('public._process_refund_single_core(uuid,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'PREMIER_REFUND_CORE_MISSING';
  END IF;
  SELECT pg_get_functiondef('public._process_refund_single_core(uuid,jsonb,text)'::regprocedure)
    INTO v_def;

  IF v_def NOT LIKE '%UPDATE sale_items%'
     OR v_def NOT LIKE '%_restore_refund_hybrid_inventory%'
     OR v_def NOT LIKE '%v_approval_id uuid;%'
     OR v_def NOT LIKE '%  EXCEPTION WHEN OTHERS THEN%'
     OR regexp_count(v_def,'RETURN v_res;') <> 3
     OR position(v_old_handler IN v_def) = 0
  THEN
    RAISE EXCEPTION 'PREMIER_REFUND_CORE_BASELINE_DRIFT';
  END IF;

  v_def := replace(v_def,
    '  v_approval_id uuid;',
    E'  v_approval_id uuid;\n  v_failure jsonb;'
  );
  v_def := replace(v_def,
    'RETURN v_res;',
    E'v_failure := v_res;\n        RAISE EXCEPTION \'PREMIER_REFUND_CORE_ABORT\' USING ERRCODE = \'P0001\';'
  );
  v_def := replace(v_def,v_old_handler,v_new_handler);
  EXECUTE v_def;
END;
$patch$;

DO $verify$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public._process_refund_single_core(uuid,jsonb,text)'::regprocedure)
    INTO v_def;
  IF v_def NOT LIKE '%v_failure jsonb%'
     OR regexp_count(v_def,'PREMIER_REFUND_CORE_ABORT') <> 4
     OR v_def LIKE '%RETURN v_res;%'
     OR v_def NOT LIKE '%WHEN SQLSTATE ''P0001''%'
     OR v_def NOT LIKE '%_restore_refund_hybrid_inventory%'
  THEN
    RAISE EXCEPTION 'PREMIER_REFUND_CORE_ATOMIC_POSTCHECK_FAILED';
  END IF;
END;
$verify$;
COMMIT;
