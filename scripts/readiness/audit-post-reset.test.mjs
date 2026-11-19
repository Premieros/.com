import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPostReset, POST_RESET_QUERIES} from './audit-post-reset.mjs';
const clean=()=>({
 catalog:{products:513,raw_materials:812,recipes:510,recipe_items:2172,inventory_units:37,users:41,branches:9,warehouses:8},
 operations:{sales:0,orders:0,purchases:0,journal_entries:0,inventory_ledger:0,raw_material_inventory:0,raw_material_batches:0},
 opening_balances:{nonzero_customer_balances:0,nonreset_document_sequences:0,occupied_tables:0},
 access:{active_profiles_without_auth:0,branches_without_active_org_member:0}
});
test('empty operational state never certifies customer handoff',()=>{
 const result=assessPostReset(clean());
 assert.equal(result.decision,'CLEAN_BASELINE');
 assert.equal(result.customer_handoff_approved,false);
 assert.ok(result.unverified.includes('cashier_sale_refund_and_shift'));
});
test('post-reset access and membership issues do not masquerade as stock debt',()=>{
 const snapshot=clean();snapshot.access.active_profiles_without_auth=29;
 snapshot.access.branches_without_active_org_member=3;
 const result=assessPostReset(snapshot);
 assert.equal(result.decision,'CLEAN_BASELINE_ACCESS_REVIEW');
 assert.deepEqual(result.access_review,['active_profiles_without_auth','branches_without_active_org_member']);
});
test('new sale or nonzero opening balance fails reset integrity',()=>{
 const snapshot=clean();snapshot.operations.sales=1; snapshot.opening_balances.nonzero_customer_balances=1;
 const result=assessPostReset(snapshot);
 assert.equal(result.decision,'RESET_INCOMPLETE');
 assert.deepEqual(result.nonzero_operations,['sales']);
 assert.deepEqual(result.nonzero_opening_balances,['nonzero_customer_balances']);
});
test('missing protected catalog or invalid aggregate fails closed',()=>{
 const snapshot=clean();snapshot.catalog.products=0;
 assert.equal(assessPostReset(snapshot).decision,'RESET_INCOMPLETE');
 snapshot.catalog.products=-1;
 assert.throws(()=>assessPostReset(snapshot),/INVALID_AGGREGATE/);
});
test('all queries read only, checks include new stock and auth',()=>{
 assert.deepEqual(Object.keys(POST_RESET_QUERIES),['catalog','operations','opening_balances','access']);
 for(const sql of Object.values(POST_RESET_QUERIES)){
   assert.match(sql,/select/i);
   assert.doesNotMatch(sql,/\b(insert|update|delete|alter|drop|truncate|create)\s+(into|table|from|public|private|auth)\b/i);
 }
 assert.match(POST_RESET_QUERIES.operations,/raw_material_inventory/);
 assert.match(POST_RESET_QUERIES.access,/auth.users/);
});
