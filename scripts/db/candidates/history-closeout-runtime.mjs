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
  }
  guards+=`IF to_regprocedure('private.run_due_business_day_closes()') IS NOT NULL OR to_regprocedure('private.business_day_fixed_cutoff(uuid,date)') IS NOT NULL THEN RAISE EXCEPTION 'CLOSEOUT_HELPER_ALREADY_PRESENT'; END IF;\nEND;\n$preflight$;\n`;
  // Remove only the known outer transaction of the original KDS candidate.
  const kds=sql.kds.replace('BEGIN;\nSET LOCAL','SET LOCAL').replace(/COMMIT;\s*$/,'');
  return { installation:guards+helpers+sql.login+'\n'+kds,
    schedulerActivation:activateScheduler?schedule:null,
    requiresExplicitProductionApproval:true,
    schedulingChangesBusinessData:activateScheduler };
}
