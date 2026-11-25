// Review-only SQL authoring. No database connection, migration-runner import or execution.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('../../../',import.meta.url);
const dir='docs/database/migration-history-audit-20261110/';
export const APPROVAL='HISTORY147_WITH_7_RECORDED_VARIANTS';
const sha=s=>createHash('sha256').update(s).digest('hex');
export async function loadCloseoutEvidence(){
  const raw=await readFile(new URL(dir+'CLOSEOUT_DISPOSITION_150.json',root),'utf8');
  const pins=await readFile(new URL(dir+'CLOSEOUT_LIVE_PINS.json',root),'utf8');
  if(sha(raw)!=='45f87ccd48e1b07c6bc28a537cba23dcc0c81fed175242554e399294259a4eb6'
    ||sha(pins)!=='2bf102f9be38ef8b0c3714ed4ab18c7659d73f54a42c56a05b3050919fe5639f') throw Error('EVIDENCE_DRIFT');
  const m=JSON.parse(raw);m.livePins=JSON.parse(pins);
  if(m.project_ref!=='hvqlkapynjfjikqithvd'||m.candidates.length!==147||m.runtime_exclusions.length!==3) throw Error('SCOPE_DRIFT');
  for(const f of m.candidates) if(sha(await readFile(new URL(f.canonical_path,root)))!==f.canonical_sha256) throw Error('CANONICAL_DRIFT');
  return m;
}
// Pure SQL formatter also exercised with synthetic metadata fixtures. Production
// callers use buildApprovedMetadataProposal(), which pins all evidence above.
export function formatMetadataSQL(m){
  if(m.candidates.length!==147||new Set(m.candidates.map(f=>f.version)).size!==147) throw Error('SCOPE_DRIFT');
  const encoded=JSON.stringify(m);
  if(encoded.includes('$closeout_manifest$')) throw Error('DELIMITER_CONFLICT');
  return `-- REVIEW CANDIDATE: 147 acknowledgements including seven explicit historical variants.
-- Never a migration or archived SQL replay. Requires separate explicit production approval.
-- Canonical project: hvqlkapynjfjikqithvd. Confirm project identity in the transport before execution.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL search_path=pg_catalog,public;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $closeout$
DECLARE
 m jsonb := $closeout_manifest$${encoded}$closeout_manifest$::jsonb;
 f jsonb; h jsonb; p jsonb; r record; c record;
 old_rows jsonb; history_before text; baseline text; n integer; inserted integer:=0;
 expected_columns jsonb := '[{"name":"id","type":"bigint","default":"nextval(''schema_migrations_id_seq''::regclass)"},{"name":"version","type":"text","default":null},{"name":"name","type":"text","default":null},{"name":"checksum","type":"text","default":null},{"name":"applied_at","type":"timestamp with time zone","default":"now()"}]';
 actual_columns jsonb;
BEGIN
 IF current_user<>'postgres' OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'CLOSEOUT_ROLE_MISMATCH'; END IF;
 LOCK TABLE public.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE;
 SELECT jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'default',column_default) ORDER BY ordinal_position) INTO actual_columns FROM information_schema.columns WHERE table_schema='public' AND table_name='schema_migrations' AND is_nullable='NO';
 IF actual_columns IS DISTINCT FROM expected_columns OR (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='schema_migrations')<>5 THEN RAISE EXCEPTION 'CLOSEOUT_LEDGER_SCHEMA_DRIFT'; END IF;
 IF NOT EXISTS(SELECT FROM pg_class WHERE oid='public.schema_migrations'::regclass AND relkind='r' AND relrowsecurity AND NOT relispartition AND relpersistence='p')
 OR EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.schema_migrations'::regclass AND NOT tgisinternal)
 OR EXISTS(SELECT FROM pg_rewrite WHERE ev_class='public.schema_migrations'::regclass)
 OR EXISTS(SELECT FROM pg_inherits WHERE inhparent='public.schema_migrations'::regclass OR inhrelid='public.schema_migrations'::regclass)
 THEN RAISE EXCEPTION 'CLOSEOUT_LEDGER_SIDE_EFFECTS'; END IF;
 IF (SELECT array_agg(pg_get_constraintdef(oid) ORDER BY pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid='public.schema_migrations'::regclass) IS DISTINCT FROM ARRAY['PRIMARY KEY (id)','UNIQUE (version)'] THEN RAISE EXCEPTION 'CLOSEOUT_LEDGER_CONSTRAINT_DRIFT'; END IF;
 SELECT md5(coalesce(string_agg(md5(row_to_json(x)::text),'' ORDER BY id),'')),count(*) INTO baseline,n FROM public.schema_migrations x WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(m->'candidates') e WHERE e->>'version'=x.version);
 IF baseline<>m->'baseline'->>'custom_fingerprint' OR n<>(m->'baseline'->>'custom_rows')::int THEN RAISE EXCEPTION 'CLOSEOUT_BASELINE_DRIFT'; END IF;
 SELECT md5(coalesce(string_agg(md5(row_to_json(x)::text),'' ORDER BY version),'')),count(*) INTO history_before,n FROM supabase_migrations.schema_migrations x;
 IF history_before<>m->'baseline'->>'history_fingerprint' OR n<>(m->'baseline'->>'history_rows')::int THEN RAISE EXCEPTION 'CLOSEOUT_HISTORY_DRIFT'; END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(m->'livePins') LOOP
  IF to_regprocedure(p->>'signature') IS NULL THEN RAISE EXCEPTION 'CLOSEOUT_LIVE_DRIFT'; END IF;
  SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') AS hash,proacl::text AS acl,prosecdef INTO r FROM pg_proc WHERE oid=to_regprocedure(p->>'signature');
  IF r.hash<>p->>'sha256' OR r.acl IS DISTINCT FROM p->>'acl' OR r.prosecdef IS DISTINCT FROM (p->>'security_definer')::boolean THEN RAISE EXCEPTION 'CLOSEOUT_LIVE_DRIFT'; END IF;
 END LOOP;
 -- Entire preflight finishes before any INSERT.
 FOR f IN SELECT value FROM jsonb_array_elements(m->'candidates') LOOP
  FOR h IN SELECT value FROM jsonb_array_elements(f->'required_history') LOOP
   SELECT name,to_jsonb(ARRAY(SELECT encode(sha256(convert_to(s,'UTF8')),'hex') FROM unnest(x.statements) s)) AS hashes INTO r FROM supabase_migrations.schema_migrations x WHERE version=h->>'version';
   IF NOT FOUND OR r.name IS DISTINCT FROM h->>'name' OR r.hashes IS DISTINCT FROM h->'statement_hashes' THEN RAISE EXCEPTION 'CLOSEOUT_SOURCE_DRIFT'; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM public.schema_migrations WHERE version=f->>'version' OR name=f->>'name';
  IF n>1 OR (n=1 AND NOT EXISTS(SELECT FROM public.schema_migrations WHERE version=f->>'version' AND name=f->>'name' AND checksum=f->>'canonical_sha256')) THEN RAISE EXCEPTION 'CLOSEOUT_LEDGER_CONFLICT'; END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') INTO old_rows FROM public.schema_migrations x;
 -- ACKNOWLEDGEMENT WRITES BEGIN
 FOR f IN SELECT value FROM jsonb_array_elements(m->'candidates') LOOP
  IF NOT EXISTS(SELECT FROM public.schema_migrations WHERE version=f->>'version') THEN
   INSERT INTO public.schema_migrations(version,name,checksum) VALUES(f->>'version',f->>'name',f->>'canonical_sha256');
   inserted:=inserted+1;
  END IF;
 END LOOP;
 -- ACKNOWLEDGEMENT WRITES END
 IF (SELECT count(*) FROM public.schema_migrations)<>jsonb_array_length(old_rows)+inserted OR EXISTS(SELECT FROM jsonb_array_elements(old_rows) o WHERE NOT EXISTS(SELECT FROM public.schema_migrations x WHERE to_jsonb(x)=o)) THEN RAISE EXCEPTION 'CLOSEOUT_EXISTING_ROW_DRIFT'; END IF;
 IF (SELECT md5(coalesce(string_agg(md5(row_to_json(x)::text),'' ORDER BY version),'')) FROM supabase_migrations.schema_migrations x)<>history_before THEN RAISE EXCEPTION 'CLOSEOUT_HISTORY_CHANGED'; END IF;
END;
$closeout$;
COMMIT;
`;
}
export async function buildApprovedMetadataProposal({approval,acceptSevenHistoricalVariants=false}={}){
  if(approval!==APPROVAL||!acceptSevenHistoricalVariants) throw Error('EXPLICIT_SEVEN_VARIANT_DECISION_REQUIRED');
  return formatMetadataSQL(await loadCloseoutEvidence());
}
export async function buildReadOnlyCloseoutCheck(){
  let sql=formatMetadataSQL(await loadCloseoutEvidence());
  const start=sql.indexOf(' -- ACKNOWLEDGEMENT WRITES BEGIN');
  const end=sql.indexOf(' -- ACKNOWLEDGEMENT WRITES END');
  if(start<0||end<start) throw Error('READONLY_BOUNDARY_DRIFT');
  sql=sql.slice(0,start)+sql.slice(end+' -- ACKNOWLEDGEMENT WRITES END'.length);
  sql=sql.replace('BEGIN;','BEGIN READ ONLY;').replace('COMMIT;','ROLLBACK;');
  sql=sql.split('\n').filter(line=>!line.trim().startsWith('LOCK TABLE ')).join('\n');
  if(sql.includes('INSERT INTO public.schema_migrations')) throw Error('READONLY_WRITE_LEAK');
  return sql;
}
