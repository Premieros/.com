// PREPARATION ONLY. Builds reviewable SQL; never connects to a database.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../../../', import.meta.url);
const hash = s => createHash('sha256').update(s).digest('hex');
const pins = {
  auto: ['20260927095000_auto_business_day_close.sql','b0b7ee70cb2bca2a640bf99d18b69e67277ccce6f47e8f3ac58185761e4b4143'],
  login: ['20261105010000_harden_login_failure_and_user_security.sql','86f7ea28b687723b3d42337a92e9b85799271da1d594c26396f6abb508c6f788'],
  kds: ['20261109143000_premier_kds_read_only_permissions.sql','35d9793cd540525f1c5a6e5aaa4854caa0749b0cd634a6625bab80fbdec4e048'],
};
export async function patchedReportDefinition(){
  const raw=await readFile(new URL('docs/database/migration-history-audit-20261110/CLOSEOUT_REPORT_BEFORE.json',root),'utf8');
  if(hash(raw)!=='80fceb34c08b1d49d1a62f7746a7755f4e98b327571419b191960db605f44a3f')throw Error('REPORT_EVIDENCE_DRIFT');
  const before=JSON.parse(raw),anchor='IF v_active_business_date=p_business_date THEN';
  if(hash(before.definition)!==before.sha256||before.definition.split(anchor).length!==2)throw Error('REPORT_ANCHOR_DRIFT');
  return before.definition.replace(anchor,"IF v_active_business_date=p_business_date AND COALESCE((v_window->>'active_state')::boolean,false) THEN");
}
export async function buildReportCutoffPatch(){
  const definition=await patchedReportDefinition();
  return `DO $report_preflight$ BEGIN
IF encode(sha256(convert_to(pg_get_functiondef('public._build_day_closing_report(uuid,date)'::regprocedure),'UTF8')),'hex')<>'f6f55aff626b32769ae601f71b0567e4ee6fe70390a1d1026606a9a928655f3f' THEN RAISE EXCEPTION 'CLOSEOUT_REPORT_DRIFT';END IF;
IF (SELECT proacl::text FROM pg_proc WHERE oid='public._build_day_closing_report(uuid,date)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN RAISE EXCEPTION 'CLOSEOUT_REPORT_ACL_DRIFT';END IF;
END;$report_preflight$;\n`+definition+';\n';
}
export async function buildRuntimeProposal({ activateScheduler = false } = {}) {
  const sql = {};
  for (const [key,[name,pin]] of Object.entries(pins)) {
    const source = await readFile(new URL('supabase/migrations/'+name,root),'utf8');
    if(hash(source)!==pin) throw Error('CANONICAL_DRIFT');
    sql[key]=source;
  }
  // Never schedule writes as an incidental consequence of installing helpers.
  const marker='DO $do$\nBEGIN\n  IF EXISTS (';
  if(sql.auto.split(marker).length!==2) throw Error('SCHEDULER_BOUNDARY_DRIFT');
  const helpers=sql.auto.slice(0,sql.auto.indexOf(marker));
  const schedule=sql.auto.slice(sql.auto.indexOf(marker));
  const beforeRaw=await readFile(new URL('docs/database/migration-history-audit-20261110/CLOSEOUT_RUNTIME_BEFORE.json',root),'utf8');
  if(hash(beforeRaw)!=='8cb7025037f7d442eb741f3bbb11d3c4e1917b6a1b488a36a8a385a8e4c1a47c') throw Error('ROLLBACK_EVIDENCE_DRIFT');
  const before=JSON.parse(beforeRaw);
  let guards=`SET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='15s';\nDO $preflight$\nBEGIN\nIF current_user<>'postgres' THEN RAISE EXCEPTION 'CLOSEOUT_ROLE_MISMATCH'; END IF;\n`;
  for(const f of before.functions) {
    const name=f.schema+'.'+f.proname+'('+f.arguments.replace(/p_username text/,'text').replace(/p_branch_id uuid/,'uuid')+')';
    guards+=`IF to_regprocedure('${name}') IS NULL OR encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${name}')),'UTF8')),'hex') <> '${f.sha256}' THEN RAISE EXCEPTION 'CLOSEOUT_FUNCTION_DRIFT'; END IF;\n`;
    guards+=`IF (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure('${name}')) IS DISTINCT FROM '${f.acl}' THEN RAISE EXCEPTION 'CLOSEOUT_ACL_DRIFT'; END IF;\n`;
    guards+=`IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure('${name}'))<>'postgres' THEN RAISE EXCEPTION 'CLOSEOUT_OWNER_DRIFT'; END IF;\n`;
  }
  guards+=`IF to_regprocedure('private.run_due_business_day_closes()') IS NOT NULL OR to_regprocedure('private.business_day_fixed_cutoff(uuid,date)') IS NOT NULL THEN RAISE EXCEPTION 'CLOSEOUT_HELPER_ALREADY_PRESENT'; END IF;\nEND;\n$preflight$;\n`;
  // Remove only the known outer transaction of the original KDS candidate.
  const kds=sql.kds.replace('BEGIN;\nSET LOCAL','SET LOCAL').replace(/COMMIT;\s*$/,'');
  return { installation:guards+helpers+await buildReportCutoffPatch()+sql.login+'\n'+kds,
    schedulerActivation:activateScheduler?schedule:null,
    requiresExplicitProductionApproval:true,
    schedulingChangesBusinessData:activateScheduler };
}
