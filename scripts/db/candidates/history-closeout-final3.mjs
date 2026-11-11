// Review-only final acknowledgement proposal, after the two approved runtime steps.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadCloseoutEvidence} from './history-closeout-metadata.mjs';
import {buildRuntimeProposal,patchedReportDefinition} from './history-closeout-runtime.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
export async function finalEvidence(){
  const m=await loadCloseoutEvidence(),runtime=await buildRuntimeProposal({activateScheduler:true});
  const functions=[];
  for(const [signature,securityDefiner,source] of [
    ['private.business_day_fixed_cutoff(uuid,date)',true,'20260927095000_auto_business_day_close.sql'],
    ['private.run_due_business_day_closes()',true,'20260927095000_auto_business_day_close.sql'],
    ['app_private.record_login_failure(text)',true,'20261105010000_harden_login_failure_and_user_security.sql'],
    ['public.record_login_failure(text)',false,'20261105010000_harden_login_failure_and_user_security.sql'],
  ]){
    const sql=await readFile(new URL('../../../supabase/migrations/'+source,import.meta.url),'utf8');
    const start=sql.indexOf('CREATE OR REPLACE FUNCTION '+signature.split('(')[0]+'(');
    const body=sql.slice(start).match(/AS \$function\$([\s\S]*?)\$function\$;/)?.[1];
    if(start<0||!body)throw Error('FUNCTION_SOURCE_DRIFT');
    const login=signature.includes('record_login_failure');
    functions.push({signature,securityDefiner,body,clientExecute:login,
      config:[signature.startsWith('public.record_login_failure')?'search_path=app_private, public, pg_temp':login?'search_path=public, pg_temp':'search_path=public, private, pg_temp'],
      volatility:signature.includes('business_day_fixed_cutoff')?'s':'v',
      returnType:signature.includes('business_day_fixed_cutoff')?'timestamp with time zone':'jsonb'});
  }
  const before=JSON.parse(await readFile(new URL('../../../docs/database/migration-history-audit-20261110/CLOSEOUT_RUNTIME_BEFORE.json',import.meta.url),'utf8'));
  const report=await patchedReportDefinition();
  functions.push({signature:'public._build_day_closing_report(uuid,date)',securityDefiner:true,
    body:report.match(/AS \$function\$([\s\S]*?)\$function\$/)[1],clientExecute:false,
    config:['search_path=public, pg_temp'],volatility:'v',returnType:'jsonb'});
  return {m,functions,kdsSha:before.functions.find(f=>f.proname==='complete_stale_kitchen_orders').sha256,
    history:[{name:'premier_history_runtime_closeout',sha256:hash(runtime.installation)},
      {name:'premier_history_auto_close_activation',sha256:hash(runtime.schedulerActivation)}]};
}
export function formatFinalThreeSQL(d){
  const encoded=JSON.stringify(d);if(encoded.includes('$final_evidence$'))throw Error('DELIMITER_CONFLICT');
  return `-- REVIEW ONLY. Run only after separately approved runtime installation AND scheduler activation.
BEGIN;
SET LOCAL timezone='UTC';SET LOCAL search_path=pg_catalog,public;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='30s';
DO $final_three$
DECLARE d jsonb:=$final_evidence$${encoded}$final_evidence$::jsonb;
 f jsonb;h jsonb;r record;n integer;baseline text;old_rows jsonb;history_before text;inserted integer:=0;
 expected_columns jsonb := '[{"name":"id","type":"bigint","nullable":"NO","default":"nextval(''schema_migrations_id_seq''::regclass)"},{"name":"version","type":"text","nullable":"NO","default":null},{"name":"name","type":"text","nullable":"NO","default":null},{"name":"checksum","type":"text","nullable":"NO","default":null},{"name":"applied_at","type":"timestamp with time zone","nullable":"NO","default":"now()"}]';
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'FINAL3_ROLE_MISMATCH';END IF;
 LOCK TABLE public.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE;
 IF NOT EXISTS(SELECT FROM pg_class WHERE oid='public.schema_migrations'::regclass AND relkind='r' AND relrowsecurity AND NOT relispartition AND relpersistence='p')
 OR EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.schema_migrations'::regclass AND NOT tgisinternal)
 OR EXISTS(SELECT FROM pg_rewrite WHERE ev_class='public.schema_migrations'::regclass)
 OR EXISTS(SELECT FROM pg_inherits WHERE inhparent='public.schema_migrations'::regclass OR inhrelid='public.schema_migrations'::regclass)
 OR (SELECT jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'nullable',is_nullable,'default',column_default) ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='schema_migrations') IS DISTINCT FROM expected_columns
 OR (SELECT array_agg(pg_get_constraintdef(oid) ORDER BY pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid='public.schema_migrations'::regclass) IS DISTINCT FROM ARRAY['PRIMARY KEY (id)','UNIQUE (version)']
 THEN RAISE EXCEPTION 'FINAL3_LEDGER_DRIFT';END IF;
 SELECT md5(coalesce(string_agg(md5(row_to_json(x)::text),'' ORDER BY id),'')),count(*) INTO baseline,n FROM public.schema_migrations x WHERE NOT EXISTS(SELECT FROM jsonb_array_elements((d->'m'->'candidates')||(d->'m'->'runtime_exclusions')) e WHERE e->>'version'=x.version);
 IF baseline<>d->'m'->'baseline'->>'custom_fingerprint' OR n<>(d->'m'->'baseline'->>'custom_rows')::int THEN RAISE EXCEPTION 'FINAL3_BASELINE_DRIFT';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(d->'m'->'candidates') LOOP
  IF (SELECT count(*) FROM public.schema_migrations WHERE version=f->>'version' AND name=f->>'name' AND checksum=f->>'canonical_sha256')<>1 THEN RAISE EXCEPTION 'FINAL3_147_INCOMPLETE';END IF;
 END LOOP;
 FOR h IN SELECT value FROM jsonb_array_elements(d->'history') LOOP
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name=h->>'name')<>1 OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name=h->>'name' AND cardinality(statements)=1 AND encode(sha256(convert_to(statements[1],'UTF8')),'hex')=h->>'sha256')<>1 THEN RAISE EXCEPTION 'FINAL3_RUNTIME_HISTORY_MISSING';END IF;
 END LOOP;
 SELECT md5(coalesce(string_agg(md5(row_to_json(x)::text),'' ORDER BY version),'')),count(*) INTO baseline,n FROM supabase_migrations.schema_migrations x WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(d->'history') e WHERE e->>'name'=x.name);
 IF baseline<>d->'m'->'baseline'->>'history_fingerprint' OR n<>(d->'m'->'baseline'->>'history_rows')::int THEN RAISE EXCEPTION 'FINAL3_ORIGINAL_HISTORY_DRIFT';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(d->'functions') LOOP
  SELECT prosrc,prosecdef,proconfig,provolatile,format_type(prorettype,null) AS return_type,pg_get_userbyid(proowner) AS owner INTO r FROM pg_proc WHERE oid=to_regprocedure(f->>'signature');
  IF NOT FOUND OR r.prosrc IS DISTINCT FROM f->>'body' OR r.prosecdef IS DISTINCT FROM (f->>'securityDefiner')::boolean OR r.owner<>'postgres'
   OR to_jsonb(r.proconfig) IS DISTINCT FROM f->'config' OR r.provolatile<>f->>'volatility' OR r.return_type<>f->>'returnType'
   OR NOT has_function_privilege('service_role',to_regprocedure(f->>'signature'),'EXECUTE')
   OR has_function_privilege('anon',to_regprocedure(f->>'signature'),'EXECUTE') IS DISTINCT FROM (f->>'clientExecute')::boolean
   OR has_function_privilege('authenticated',to_regprocedure(f->>'signature'),'EXECUTE') IS DISTINCT FROM (f->>'clientExecute')::boolean
  THEN RAISE EXCEPTION 'FINAL3_FUNCTION_DRIFT';END IF;
 END LOOP;
 IF encode(sha256(convert_to(pg_get_functiondef('public.complete_stale_kitchen_orders(uuid)'::regprocedure),'UTF8')),'hex')<>d->>'kdsSha'
 OR has_function_privilege('authenticated','public.complete_stale_kitchen_orders(uuid)','EXECUTE')
 OR has_function_privilege('anon','public.complete_stale_kitchen_orders(uuid)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.complete_stale_kitchen_orders(uuid)','EXECUTE') THEN RAISE EXCEPTION 'FINAL3_KDS_DRIFT';END IF;
 IF (SELECT count(*) FROM cron.job WHERE jobname='auto-business-day-close' AND schedule='* * * * *' AND command='SELECT private.run_due_business_day_closes();' AND active AND username='postgres' AND database=current_database())<>1 THEN RAISE EXCEPTION 'FINAL3_SCHEDULER_NOT_ACTIVE';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(d->'m'->'runtime_exclusions') LOOP
  SELECT count(*) INTO n FROM public.schema_migrations WHERE version=f->>'version' OR name=f->>'name';
  IF n>1 OR (n=1 AND NOT EXISTS(SELECT FROM public.schema_migrations WHERE version=f->>'version' AND name=f->>'name' AND checksum=f->>'canonical_sha256')) THEN RAISE EXCEPTION 'FINAL3_LEDGER_CONFLICT';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') INTO old_rows FROM public.schema_migrations x;
 SELECT md5(coalesce(string_agg(md5(row_to_json(x)::text),'' ORDER BY version),'')) INTO history_before FROM supabase_migrations.schema_migrations x;
 FOR f IN SELECT value FROM jsonb_array_elements(d->'m'->'runtime_exclusions') LOOP
  IF NOT EXISTS(SELECT FROM public.schema_migrations WHERE version=f->>'version') THEN
   INSERT INTO public.schema_migrations(version,name,checksum) VALUES(f->>'version',f->>'name',f->>'canonical_sha256');inserted:=inserted+1;
  END IF;
 END LOOP;
 IF (SELECT count(*) FROM public.schema_migrations)<>jsonb_array_length(old_rows)+inserted OR EXISTS(SELECT FROM jsonb_array_elements(old_rows) o WHERE NOT EXISTS(SELECT FROM public.schema_migrations x WHERE to_jsonb(x)=o)) THEN RAISE EXCEPTION 'FINAL3_EXISTING_ROW_DRIFT';END IF;
 IF (SELECT md5(coalesce(string_agg(md5(row_to_json(x)::text),'' ORDER BY version),'')) FROM supabase_migrations.schema_migrations x)<>history_before THEN RAISE EXCEPTION 'FINAL3_HISTORY_CHANGED';END IF;
END;
$final_three$;
COMMIT;
`;
}
export async function buildFinalThreeProposal(){return formatFinalThreeSQL(await finalEvidence());}
