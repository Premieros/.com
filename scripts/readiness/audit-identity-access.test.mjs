import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyAccess,ACCESS_QUERIES} from './audit-identity-access.mjs';
const clean=()=>({
 identities:{active_missing_auth:0,email_match_different_identity:0,missing_privileged_profiles:0},
 memberships:{active_members_missing_auth:0,branches_without_active_org_member:0},
 branch_access:{links_without_auth:0,links_without_profile:0,links_without_branch:0},
 super_admin_scope:{non_global_super_admin_profiles:0,super_admin_direct_branch_links:0},
 policies:{public_without_rls:0,anon_readable_tables:0,anonymous_security_definer_functions:0}
});
test('all passed access checks do not grant customer handoff or write permission',()=>{
 const r=classifyAccess(clean());
 assert.equal(r.decision,'TECHNICAL_ACCESS_CHECKS_PASS');
 assert.equal(r.customer_handoff_approved,false);
 assert.equal(r.actions_authorized,false);
});
test('unmatched staff, privileged identities, missing org memberships block release',()=>{
 const s=clean();s.identities.active_missing_auth=29;
 s.identities.missing_privileged_profiles=7;
 s.memberships.branches_without_active_org_member=3;
 s.branch_access.links_without_auth=29;
 const r=classifyAccess(s);
 assert.equal(r.decision,'BLOCKED');
 assert.equal(r.checks.find(x=>x.id==='active_missing_auth').count,29);
});
test('email collision and anonymous definer are review not identity match',()=>{
 const s=clean();s.identities.email_match_different_identity=1;
 s.policies.anonymous_security_definer_functions=1;
 const r=classifyAccess(s);
 assert.equal(r.decision,'REVIEW_REQUIRED');
});
test('rejects invalid counts and incomplete evidence',()=>{
 assert.throws(()=>classifyAccess({}),/INVALID_SNAPSHOT/);
 const s=clean();s.branch_access.links_without_auth=-1;
 assert.throws(()=>classifyAccess(s),/INVALID_AGGREGATE/);
});
test('SQL is SELECT-only and outputs no employee emails',()=>{
 for(const sql of Object.values(ACCESS_QUERIES)){
  assert.match(sql,/select/i);
  assert.doesNotMatch(sql,/\b(insert|update|delete|alter|drop|truncate|create)\s+(into|table|from|public|private|auth)\b/i);
 }
 assert.match(ACCESS_QUERIES.identities,/auth\.users/);
 assert.match(ACCESS_QUERIES.branch_access,/user_branch_access/);
});

test('super-admin must stay global without branch binding or direct grant',()=>{
 const s=clean();s.super_admin_scope.super_admin_direct_branch_links=1;
 assert.equal(classifyAccess(s).decision,'BLOCKED');
 s.super_admin_scope.super_admin_direct_branch_links=0;
 s.super_admin_scope.non_global_super_admin_profiles=1;
 assert.equal(classifyAccess(s).decision,'BLOCKED');
});
