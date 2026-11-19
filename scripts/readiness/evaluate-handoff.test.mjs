import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateHandoff,REQUIRED_EVIDENCE} from './evaluate-handoff.mjs';
const audit = () => ({project_ref:'hvqlkapynjfjikqithvd',decision:'TECHNICAL_CHECKS_PASS',checks:[{id:'ledger',status:'PASS',count:0}]});
const evidence = () => Object.fromEntries(REQUIRED_EVIDENCE.map(k=>[k,{result:'PASS',owner:'QA',reference:'signed-test-report',checked_at:'2026-11-19T08:00:00Z'}]));
test('does not certify delivery without operational evidence',()=> {
 const result=evaluateHandoff(audit(),{});
 assert.equal(result.decision,'NOT_READY');
 assert.equal(result.missing_evidence.length,REQUIRED_EVIDENCE.length);
});
test('rejects positive but unreferenced attestation',()=> {
 const ev=evidence();ev.restore_rehearsal.reference='';
 assert.ok(evaluateHandoff(audit(),ev).missing_evidence.includes('restore_rehearsal'));
});
test('review or blocker is never silently ignored',()=>{
 const a=audit();a.checks.push({id:'negative_raw_balances',status:'REVIEW',count:146});
 assert.equal(evaluateHandoff(a,evidence()).decision,'NOT_READY');
 a.checks[1].status='BLOCKER';
 assert.equal(evaluateHandoff(a,evidence()).decision,'NOT_READY');
});
test('rejects wrong database and never grants production mutations',()=>{
 assert.throws(()=>evaluateHandoff({...audit(),project_ref:'other'},evidence()),/WRONG_PROJECT/);
 const r=evaluateHandoff(audit(),evidence());
 assert.equal(r.decision,'DELIVERY_GATE_PASS');
 assert.equal(r.production_mutations_authorized,false);
});
