import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateHandoff,REQUIRED_EVIDENCE} from './evaluate-handoff.mjs';
const audit = () => ({project_ref:'hvqlkapynjfjikqithvd',decision:'TECHNICAL_CHECKS_PASS',checks:[{id:'ledger',status:'PASS',count:0}]});
const access = () => ({project_ref:'hvqlkapynjfjikqithvd',checked_at:'2026-11-19T09:00:00Z',decision:'TECHNICAL_ACCESS_CHECKS_PASS',checks:[{id:'active_missing_auth',status:'PASS',count:0}]});
const evidence = () => Object.fromEntries(REQUIRED_EVIDENCE.map(k=>[k,{result:'PASS',owner:'QA',reference:'signed-test-report',checked_at:'2026-11-19T08:00:00Z'}]));
test('does not certify delivery without operational evidence',()=> {
 const result=evaluateHandoff(audit(),{},access());
 assert.equal(result.decision,'NOT_READY');
 assert.equal(result.missing_evidence.length,REQUIRED_EVIDENCE.length);
});
test('rejects positive but unreferenced attestation',()=> {
 const ev=evidence();ev.restore_rehearsal.reference='';
 assert.ok(evaluateHandoff(audit(),ev,access()).missing_evidence.includes('restore_rehearsal'));
});
test('review or blocker is never silently ignored',()=>{
 const a=audit();a.checks.push({id:'negative_raw_balances',status:'REVIEW',count:146});
 assert.equal(evaluateHandoff(a,evidence(),access()).decision,'NOT_READY');
 a.checks[1].status='BLOCKER';
 assert.equal(evaluateHandoff(a,evidence(),access()).decision,'NOT_READY');
});
test('rejects wrong database and never grants production mutations',()=>{
 assert.throws(()=>evaluateHandoff({...audit(),project_ref:'other'},evidence(),access()),/WRONG_PROJECT/);
 const r=evaluateHandoff(audit(),evidence(),access());
 assert.equal(r.decision,'DELIVERY_GATE_PASS');
 assert.equal(r.production_mutations_authorized,false);
});

test('missing independent identity audit fails closed',()=>{
 assert.throws(()=>evaluateHandoff(audit(),evidence()),/ACCESS_AUDIT_REQUIRED/);
});
test('unmatched active staff, bad tenant membership and privileged RPC review block handoff',()=>{
 const a=access();
 a.decision='BLOCKED';
 a.checks=[
  {id:'active_missing_auth',status:'BLOCKER',count:29},
  {id:'branches_without_active_org_member',status:'BLOCKER',count:3},
  {id:'anonymous_security_definer_functions',status:'REVIEW',count:1}
 ];
 const result=evaluateHandoff(audit(),evidence(),a);
 assert.equal(result.decision,'NOT_READY');
 assert.deepEqual(result.blocking_access_checks,[
  'active_missing_auth','branches_without_active_org_member','anonymous_security_definer_functions'
 ]);
});
test('access project mismatch and malformed audit never pass',()=>{
 assert.throws(()=>evaluateHandoff(audit(),evidence(),{...access(),project_ref:'unrelated'}),/WRONG_ACCESS_PROJECT/);
 assert.throws(()=>evaluateHandoff(audit(),evidence(),{...access(),checked_at:'bad'}),/INVALID_ACCESS_TIMESTAMP/);
 const a=access();a.checks[0].status='MAGIC';
 assert.throws(()=>evaluateHandoff(audit(),evidence(),a),/INVALID_ACCESS_CHECK/);
});
