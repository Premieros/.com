// Single-request transport of the approved metadata operation. No migration SQL runs.
import { loadEvidence, assertTarget, PROJECT, reconcile } from './reconcile-premier-p0-ledger.mjs';

const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const sha = expression => `encode(sha256(convert_to(${expression},'UTF8')),'hex')`;

export async function buildApprovedBatch() {
  const manifest = await loadEvidence();
  const rows = manifest.migrations.map(m => ({...m,
    stem:m.canonical_path.split('/').pop().slice(0,-4),
    filename:m.canonical_path.split('/').pop()}));
  const stems = rows.map(m=>quote(m.stem)).join(',');
  const functionChecks = manifest.functions.map(f => `
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(${quote('public.'+f.signature)})
    AND ${sha('pg_get_functiondef(p.oid)')}=${quote(f.sha256)}
    AND p.proacl::text=${quote(f.acl)} AND p.prosecdef=${f.security_definer}
    AND p.provolatile=${quote(f.volatility)} AND to_jsonb(p.proconfig)=${quote(JSON.stringify(f.config))}::jsonb
    AND has_function_privilege('anon',p.oid,'EXECUTE')=${f.anon_execute}
    AND has_function_privilege('authenticated',p.oid,'EXECUTE')=${f.authenticated_execute}
  ) THEN RAISE EXCEPTION 'LIVE_FUNCTION_DRIFT'; END IF;`).join('\n');
  const migrationChecks = rows.map(m=>`
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version=${quote(m.version)} AND name=${quote(m.name)}
    AND cardinality(statements)=1 AND ${sha('statements[1]')}=${quote(m.sha256)})
  THEN RAISE EXCEPTION 'REMOTE_MIGRATION_DRIFT'; END IF;
  IF EXISTS (SELECT 1 FROM public.schema_migrations
    WHERE (version=${quote(m.stem)} OR name=${quote(m.filename)})
      AND (version IS DISTINCT FROM ${quote(m.stem)} OR name IS DISTINCT FROM ${quote(m.filename)}
        OR checksum IS DISTINCT FROM ${quote(m.sha256)}))
  THEN RAISE EXCEPTION 'LEDGER_RECORD_CONFLICT'; END IF;`).join('\n');
  const inserts=rows.map(m=>`
  INSERT INTO public.schema_migrations(version,name,checksum)
    SELECT ${quote(m.stem)},${quote(m.filename)},${quote(m.sha256)}
    WHERE NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version=${quote(m.stem)});
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  v_inserted := v_inserted + v_rows;`).join('\n');
  const columns=[['id','bigint','NO',"nextval('schema_migrations_id_seq'::regclass)"],
    ['version','text','NO',null],['name','text','NO',null],['checksum','text','NO',null],
    ['applied_at','timestamp with time zone','NO','now()']];
  return `-- Approved scope: ${PROJECT}; exactly three P0 custom-ledger acknowledgements.
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
    IS DISTINCT FROM ${quote(JSON.stringify(columns))}::jsonb
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
${migrationChecks}
${functionChecks}
  SELECT count(*) INTO v_before FROM public.schema_migrations;
  SELECT md5(coalesce(string_agg(md5(row_to_json(m)::text),'' ORDER BY version),'')) INTO v_remote
    FROM supabase_migrations.schema_migrations m;
  SELECT md5(coalesce(string_agg(md5(row_to_json(m)::text),'' ORDER BY version),'')) INTO v_unrelated
    FROM public.schema_migrations m WHERE version NOT IN (${stems});
${inserts}
${migrationChecks}
${functionChecks}
  IF (SELECT count(*) FROM public.schema_migrations) <> v_before+v_inserted
    OR v_inserted NOT BETWEEN 0 AND 3
  THEN RAISE EXCEPTION 'LEDGER_ROW_COUNT_CHANGED'; END IF;
  IF (SELECT count(*) FROM public.schema_migrations WHERE version IN (${stems})) <> 3
  THEN RAISE EXCEPTION 'ACKNOWLEDGEMENTS_INCOMPLETE'; END IF;
  IF (SELECT md5(coalesce(string_agg(md5(row_to_json(m)::text),'' ORDER BY version),''))
    FROM supabase_migrations.schema_migrations m) IS DISTINCT FROM v_remote
  THEN RAISE EXCEPTION 'REMOTE_HISTORY_CHANGED'; END IF;
  IF (SELECT md5(coalesce(string_agg(md5(row_to_json(m)::text),'' ORDER BY version),''))
    FROM public.schema_migrations m WHERE version NOT IN (${stems})) IS DISTINCT FROM v_unrelated
  THEN RAISE EXCEPTION 'UNRELATED_LEDGER_CHANGED'; END IF;
  PERFORM set_config('premier.p0_ack_result',jsonb_build_object('inserted',v_inserted,
    'ledgerRowsBefore',v_before,'ledgerRowsAfter',v_before+v_inserted,
    'remoteHistoryUnchanged',true,'unrelatedLedgerUnchanged',true)::text,true);
END;
$p0_metadata$;
SELECT current_setting('premier.p0_ack_result')::jsonb AS result;
COMMIT;
`;
}

// Same target guards as the CLI; a hosted connector instead enforces project_id on its request.
export async function reconcileBatch(client, options={}) {
  if (!options.execute) return reconcile(client,options);
  assertTarget(client.connectionParameters.host,client.connectionParameters.user,options.project,options.testOnly);
  try {
    const results=await client.query(await buildApprovedBatch());
    return results.find(r=>r.rows?.[0]?.result)?.rows[0].result;
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw new Error(/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'RECONCILIATION_ABORTED');
  }
}
