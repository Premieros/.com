-- Approved scope: hvqlkapynjfjikqithvd; exactly three P0 custom-ledger acknowledgements.
-- Run only through an explicitly project-scoped connection. Original migrations are never executed.
BEGIN;
SET LOCAL search_path TO pg_catalog,public;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE;
DO $p0_metadata$
DECLARE
  v_before bigint;
  v_rows integer;
  v_inserted integer := 0;
  v_remote text;
  v_unrelated text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user
    AND rolname='postgres' AND (rolsuper OR rolbypassrls))
  THEN RAISE EXCEPTION 'DATABASE_ROLE_MISMATCH'; END IF;
  IF (SELECT jsonb_agg(jsonb_build_array(column_name,data_type,is_nullable,column_default) ORDER BY ordinal_position)
    FROM information_schema.columns WHERE table_schema='public' AND table_name='schema_migrations')
    IS DISTINCT FROM '[["id","bigint","NO","nextval(''schema_migrations_id_seq''::regclass)"],["version","text","NO",null],["name","text","NO",null],["checksum","text","NO",null],["applied_at","timestamp with time zone","NO","now()"]]'::jsonb
  THEN RAISE EXCEPTION 'LEDGER_SCHEMA_DRIFT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid='public.schema_migrations'::regclass
    AND relkind='r' AND relrowsecurity
    AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)
    AND NOT EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class=c.oid))
  THEN RAISE EXCEPTION 'LEDGER_SIDE_EFFECTS'; END IF;
  IF (SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY pg_get_constraintdef(oid))
    FROM pg_constraint WHERE conrelid='public.schema_migrations'::regclass)
    IS DISTINCT FROM '["PRIMARY KEY (id)","UNIQUE (version)"]'::jsonb
  THEN RAISE EXCEPTION 'LEDGER_CONSTRAINT_DRIFT'; END IF;

  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20261110104453' AND name='premier_stock_valuation_rpc_branch_auth_20261110'
    AND cardinality(statements)=1 AND encode(sha256(convert_to(statements[1],'UTF8')),'hex')='4855885a35e2ee544d7911fae9a21da729a20c6f7a5455624c2de9fbec3e4625')
  THEN RAISE EXCEPTION 'REMOTE_MIGRATION_DRIFT'; END IF;
  IF EXISTS (SELECT 1 FROM public.schema_migrations
    WHERE (version='20261109180000_premier_stock_valuation_rpc_branch_auth' OR name='20261109180000_premier_stock_valuation_rpc_branch_auth.sql')
      AND (version IS DISTINCT FROM '20261109180000_premier_stock_valuation_rpc_branch_auth' OR name IS DISTINCT FROM '20261109180000_premier_stock_valuation_rpc_branch_auth.sql'
        OR checksum IS DISTINCT FROM '4855885a35e2ee544d7911fae9a21da729a20c6f7a5455624c2de9fbec3e4625'))
  THEN RAISE EXCEPTION 'LEDGER_RECORD_CONFLICT'; END IF;

  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20261110104523' AND name='premier_refund_core_atomic_failure_20261110'
    AND cardinality(statements)=1 AND encode(sha256(convert_to(statements[1],'UTF8')),'hex')='2c9a027612c030fa4e3b59eb134ea40e43ae4ccf190c19e04db916b29e035699')
  THEN RAISE EXCEPTION 'REMOTE_MIGRATION_DRIFT'; END IF;
  IF EXISTS (SELECT 1 FROM public.schema_migrations
    WHERE (version='20261109183000_premier_refund_core_atomic_failure' OR name='20261109183000_premier_refund_core_atomic_failure.sql')
      AND (version IS DISTINCT FROM '20261109183000_premier_refund_core_atomic_failure' OR name IS DISTINCT FROM '20261109183000_premier_refund_core_atomic_failure.sql'
        OR checksum IS DISTINCT FROM '2c9a027612c030fa4e3b59eb134ea40e43ae4ccf190c19e04db916b29e035699'))
  THEN RAISE EXCEPTION 'LEDGER_RECORD_CONFLICT'; END IF;

  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20261110104600' AND name='premier_stock_count_atomic_failures_20261110'
    AND cardinality(statements)=1 AND encode(sha256(convert_to(statements[1],'UTF8')),'hex')='a891b7c62043fc3e9632a5b304950020da984d09a6fae6cf1035e74c33e26fed')
  THEN RAISE EXCEPTION 'REMOTE_MIGRATION_DRIFT'; END IF;
  IF EXISTS (SELECT 1 FROM public.schema_migrations
    WHERE (version='20261109140000_premier_stock_count_atomic_failures' OR name='20261109140000_premier_stock_count_atomic_failures.sql')
      AND (version IS DISTINCT FROM '20261109140000_premier_stock_count_atomic_failures' OR name IS DISTINCT FROM '20261109140000_premier_stock_count_atomic_failures.sql'
        OR checksum IS DISTINCT FROM 'a891b7c62043fc3e9632a5b304950020da984d09a6fae6cf1035e74c33e26fed'))
  THEN RAISE EXCEPTION 'LEDGER_RECORD_CONFLICT'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public._process_refund_single_core(uuid,jsonb,text)')
    AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='57bd2920ff372a280ed7d755407a1592f57ae0e3e7ec9ef45a33c65017c3e10b'
    AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' AND p.prosecdef=true
    AND p.provolatile='v' AND to_jsonb(p.proconfig)='["search_path=public, pg_temp"]'::jsonb
    AND has_function_privilege('anon',p.oid,'EXECUTE')=false
    AND has_function_privilege('authenticated',p.oid,'EXECUTE')=false
  ) THEN RAISE EXCEPTION 'LIVE_FUNCTION_DRIFT'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.apply_stock_count(uuid)')
    AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='ab1dcab7df1d1a033dc699b3d93cd79d8403e6521d24ee5b8ea87de62679d98f'
    AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' AND p.prosecdef=true
    AND p.provolatile='v' AND to_jsonb(p.proconfig)='["search_path=public, pg_temp"]'::jsonb
    AND has_function_privilege('anon',p.oid,'EXECUTE')=false
    AND has_function_privilege('authenticated',p.oid,'EXECUTE')=true
  ) THEN RAISE EXCEPTION 'LIVE_FUNCTION_DRIFT'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.get_stock_valuation(uuid,uuid)')
    AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='b74eab3a0c2d0514ccfb5537f1381b109b14f7f7e87b8b22d132d448019fd07a'
    AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' AND p.prosecdef=true
    AND p.provolatile='s' AND to_jsonb(p.proconfig)='["search_path=public, pg_temp"]'::jsonb
    AND has_function_privilege('anon',p.oid,'EXECUTE')=false
    AND has_function_privilege('authenticated',p.oid,'EXECUTE')=true
  ) THEN RAISE EXCEPTION 'LIVE_FUNCTION_DRIFT'; END IF;
  SELECT count(*) INTO v_before FROM public.schema_migrations;
  SELECT md5(coalesce(string_agg(md5(row_to_json(m)::text),'' ORDER BY version),'')) INTO v_remote
    FROM supabase_migrations.schema_migrations m;
  SELECT md5(coalesce(string_agg(md5(row_to_json(m)::text),'' ORDER BY version),'')) INTO v_unrelated
    FROM public.schema_migrations m WHERE version NOT IN ('20261109180000_premier_stock_valuation_rpc_branch_auth','20261109183000_premier_refund_core_atomic_failure','20261109140000_premier_stock_count_atomic_failures');

  INSERT INTO public.schema_migrations(version,name,checksum)
    SELECT '20261109180000_premier_stock_valuation_rpc_branch_auth','20261109180000_premier_stock_valuation_rpc_branch_auth.sql','4855885a35e2ee544d7911fae9a21da729a20c6f7a5455624c2de9fbec3e4625'
    WHERE NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='20261109180000_premier_stock_valuation_rpc_branch_auth');
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  INSERT INTO public.schema_migrations(version,name,checksum)
    SELECT '20261109183000_premier_refund_core_atomic_failure','20261109183000_premier_refund_core_atomic_failure.sql','2c9a027612c030fa4e3b59eb134ea40e43ae4ccf190c19e04db916b29e035699'
    WHERE NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='20261109183000_premier_refund_core_atomic_failure');
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  INSERT INTO public.schema_migrations(version,name,checksum)
    SELECT '20261109140000_premier_stock_count_atomic_failures','20261109140000_premier_stock_count_atomic_failures.sql','a891b7c62043fc3e9632a5b304950020da984d09a6fae6cf1035e74c33e26fed'
    WHERE NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='20261109140000_premier_stock_count_atomic_failures');
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20261110104453' AND name='premier_stock_valuation_rpc_branch_auth_20261110'
    AND cardinality(statements)=1 AND encode(sha256(convert_to(statements[1],'UTF8')),'hex')='4855885a35e2ee544d7911fae9a21da729a20c6f7a5455624c2de9fbec3e4625')
  THEN RAISE EXCEPTION 'REMOTE_MIGRATION_DRIFT'; END IF;
  IF EXISTS (SELECT 1 FROM public.schema_migrations
    WHERE (version='20261109180000_premier_stock_valuation_rpc_branch_auth' OR name='20261109180000_premier_stock_valuation_rpc_branch_auth.sql')
      AND (version IS DISTINCT FROM '20261109180000_premier_stock_valuation_rpc_branch_auth' OR name IS DISTINCT FROM '20261109180000_premier_stock_valuation_rpc_branch_auth.sql'
        OR checksum IS DISTINCT FROM '4855885a35e2ee544d7911fae9a21da729a20c6f7a5455624c2de9fbec3e4625'))
  THEN RAISE EXCEPTION 'LEDGER_RECORD_CONFLICT'; END IF;

  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20261110104523' AND name='premier_refund_core_atomic_failure_20261110'
    AND cardinality(statements)=1 AND encode(sha256(convert_to(statements[1],'UTF8')),'hex')='2c9a027612c030fa4e3b59eb134ea40e43ae4ccf190c19e04db916b29e035699')
  THEN RAISE EXCEPTION 'REMOTE_MIGRATION_DRIFT'; END IF;
  IF EXISTS (SELECT 1 FROM public.schema_migrations
    WHERE (version='20261109183000_premier_refund_core_atomic_failure' OR name='20261109183000_premier_refund_core_atomic_failure.sql')
      AND (version IS DISTINCT FROM '20261109183000_premier_refund_core_atomic_failure' OR name IS DISTINCT FROM '20261109183000_premier_refund_core_atomic_failure.sql'
        OR checksum IS DISTINCT FROM '2c9a027612c030fa4e3b59eb134ea40e43ae4ccf190c19e04db916b29e035699'))
  THEN RAISE EXCEPTION 'LEDGER_RECORD_CONFLICT'; END IF;

  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20261110104600' AND name='premier_stock_count_atomic_failures_20261110'
    AND cardinality(statements)=1 AND encode(sha256(convert_to(statements[1],'UTF8')),'hex')='a891b7c62043fc3e9632a5b304950020da984d09a6fae6cf1035e74c33e26fed')
  THEN RAISE EXCEPTION 'REMOTE_MIGRATION_DRIFT'; END IF;
  IF EXISTS (SELECT 1 FROM public.schema_migrations
    WHERE (version='20261109140000_premier_stock_count_atomic_failures' OR name='20261109140000_premier_stock_count_atomic_failures.sql')
      AND (version IS DISTINCT FROM '20261109140000_premier_stock_count_atomic_failures' OR name IS DISTINCT FROM '20261109140000_premier_stock_count_atomic_failures.sql'
        OR checksum IS DISTINCT FROM 'a891b7c62043fc3e9632a5b304950020da984d09a6fae6cf1035e74c33e26fed'))
  THEN RAISE EXCEPTION 'LEDGER_RECORD_CONFLICT'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public._process_refund_single_core(uuid,jsonb,text)')
    AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='57bd2920ff372a280ed7d755407a1592f57ae0e3e7ec9ef45a33c65017c3e10b'
    AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' AND p.prosecdef=true
    AND p.provolatile='v' AND to_jsonb(p.proconfig)='["search_path=public, pg_temp"]'::jsonb
    AND has_function_privilege('anon',p.oid,'EXECUTE')=false
    AND has_function_privilege('authenticated',p.oid,'EXECUTE')=false
  ) THEN RAISE EXCEPTION 'LIVE_FUNCTION_DRIFT'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.apply_stock_count(uuid)')
    AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='ab1dcab7df1d1a033dc699b3d93cd79d8403e6521d24ee5b8ea87de62679d98f'
    AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' AND p.prosecdef=true
    AND p.provolatile='v' AND to_jsonb(p.proconfig)='["search_path=public, pg_temp"]'::jsonb
    AND has_function_privilege('anon',p.oid,'EXECUTE')=false
    AND has_function_privilege('authenticated',p.oid,'EXECUTE')=true
  ) THEN RAISE EXCEPTION 'LIVE_FUNCTION_DRIFT'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.get_stock_valuation(uuid,uuid)')
    AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='b74eab3a0c2d0514ccfb5537f1381b109b14f7f7e87b8b22d132d448019fd07a'
    AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' AND p.prosecdef=true
    AND p.provolatile='s' AND to_jsonb(p.proconfig)='["search_path=public, pg_temp"]'::jsonb
    AND has_function_privilege('anon',p.oid,'EXECUTE')=false
    AND has_function_privilege('authenticated',p.oid,'EXECUTE')=true
  ) THEN RAISE EXCEPTION 'LIVE_FUNCTION_DRIFT'; END IF;
  IF (SELECT count(*) FROM public.schema_migrations) <> v_before+v_inserted
    OR v_inserted NOT BETWEEN 0 AND 3
  THEN RAISE EXCEPTION 'LEDGER_ROW_COUNT_CHANGED'; END IF;
  IF (SELECT count(*) FROM public.schema_migrations WHERE version IN ('20261109180000_premier_stock_valuation_rpc_branch_auth','20261109183000_premier_refund_core_atomic_failure','20261109140000_premier_stock_count_atomic_failures')) <> 3
  THEN RAISE EXCEPTION 'ACKNOWLEDGEMENTS_INCOMPLETE'; END IF;
  IF (SELECT md5(coalesce(string_agg(md5(row_to_json(m)::text),'' ORDER BY version),''))
    FROM supabase_migrations.schema_migrations m) IS DISTINCT FROM v_remote
  THEN RAISE EXCEPTION 'REMOTE_HISTORY_CHANGED'; END IF;
  IF (SELECT md5(coalesce(string_agg(md5(row_to_json(m)::text),'' ORDER BY version),''))
    FROM public.schema_migrations m WHERE version NOT IN ('20261109180000_premier_stock_valuation_rpc_branch_auth','20261109183000_premier_refund_core_atomic_failure','20261109140000_premier_stock_count_atomic_failures')) IS DISTINCT FROM v_unrelated
  THEN RAISE EXCEPTION 'UNRELATED_LEDGER_CHANGED'; END IF;
  PERFORM set_config('premier.p0_ack_result',jsonb_build_object('inserted',v_inserted,
    'ledgerRowsBefore',v_before,'ledgerRowsAfter',v_before+v_inserted,
    'remoteHistoryUnchanged',true,'unrelatedLedgerUnchanged',true)::text,true);
END;
$p0_metadata$;
SELECT current_setting('premier.p0_ack_result')::jsonb AS result;
COMMIT;
