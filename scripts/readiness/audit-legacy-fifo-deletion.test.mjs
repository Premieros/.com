import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyImpact} from './audit-legacy-fifo-deletion.mjs';

test('preflight never authorizes deletion even with no dependent rows',()=>{
 const r=classifyImpact({
  debt_scope:{total:0,legacy_total:0,non_legacy_total:0},
  relationships:{cascading_settlements:0,restricted_rebase_snapshots:0,restricted_rebase_settlement_snapshots:0},
  inventory:{negative_balances:0},blocking_fks:{restrict_fk_count:0}
 });
 assert.equal(r.deletion_authorized,false);
 assert.equal(r.status,'ISOLATED_REHEARSAL_REQUIRED');
});
test('preflight reports dependencies and mixed policies',()=>{
 const r=classifyImpact({
  debt_scope:{total:10,legacy_total:9,non_legacy_total:1},
  relationships:{cascading_settlements:4,restricted_rebase_snapshots:2,restricted_rebase_settlement_snapshots:3},
  inventory:{negative_balances:5},blocking_fks:{restrict_fk_count:2}
 });
 assert.equal(r.dependent_rows,9);
 assert.equal(r.historical_scope_is_legacy_only,false);
 assert.equal(r.deletion_authorized,false);
});
