import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertTarget, classifyReadiness, READINESS_QUERIES } from './audit-production.mjs';

const clean = () => ({
  schema: { unprotected_tables:0, anon_readable_tables:0 },
  integrity: { orphan_items:0, orphan_payments:0, orphan_lines:0, duplicate_invoices:0 },
  accounting: { unbalanced:0, unbalanced_posted:0, empty_entries:0 },
  inventory: { negatives:0, negative_raw_batches:0, raw_batch_balance_mismatches:0,
    negative_balance_batch_disagreements:0, unsettled_fifo_debts:0 },
  accounts: { active_without_auth:0, branches_without_members:0 }
});

test('clean aggregate passes technical checks but does not claim full production readiness', () => {
  const result = classifyReadiness(clean());
  assert.equal(result.decision, 'TECHNICAL_CHECKS_PASS');
  assert.ok(result.unverified.includes('backup_restore_and_RPO_RTO'));
  assert.ok(result.unverified.includes('cashier_sale_refund_and_shift_on_isolated_environment'));
});

test('deleted historical debts do not turn consistent negative stock into a blocker', () => {
  const data=clean();
  data.inventory.negatives=146;
  data.inventory.negative_raw_batches=6424;
  const result=classifyReadiness(data);
  assert.equal(result.decision,'TECHNICAL_CHECKS_PASS');
  assert.equal(result.customer_data_decision,'CUSTOMER_DATA_REVIEW');
  assert.equal(result.checks.find(x=>x.id==='raw_batch_balance_mismatches').status,'PASS');
  assert.equal(result.checks.find(x=>x.id==='negative_raw_balances').status,'REVIEW');
  assert.ok(result.unverified.includes('legacy_negative_stock_physical_reconciliation'));
});

test('stock/batch discrepancy or unbalanced accounting blocks technical approval', () => {
  const data=clean();
  data.inventory.raw_batch_balance_mismatches=1;
  data.accounting.unbalanced_posted=1;
  const result=classifyReadiness(data);
  assert.equal(result.decision,'NO_GO');
});

test('new outstanding FIFO debts stay visible after historical deletion', () => {
  const data=clean();
  data.inventory.unsettled_fifo_debts=1;
  const result=classifyReadiness(data);
  assert.equal(result.decision,'REVIEW_REQUIRED');
});

test('rejects arbitrary project and database connections before connecting', () => {
  const ref='hvqlkapynjfjikqithvd';
  const env={SUPABASE_PROJECT_REF:ref,SUPABASE_DB_URL:'postgresql://postgres:secret@db.hvqlkapynjfjikqithvd.supabase.co/postgres'};
  assert.throws(() => assertTarget([],env), /PROJECT_CONFIRMATION_REQUIRED/);
  assert.throws(() => assertTarget(['--confirm-project=another'],env), /PROJECT_CONFIRMATION_REQUIRED/);
  assert.throws(() => assertTarget(['--confirm-project='+ref],{
    ...env,SUPABASE_DB_URL:'postgresql://postgres:secret@db.unrelated.supabase.co/postgres'
  }), /WRONG_PROJECT_CONNECTION/);
  assert.equal(assertTarget(['--confirm-project='+ref],env).ref,ref);
});

test('audit queries do not contain data mutation and cover critical integrity invariants', () => {
  assert.deepEqual(Object.keys(READINESS_QUERIES), ['schema','integrity','accounting','inventory','accounts']);
  for (const sql of Object.values(READINESS_QUERIES)) {
    assert.match(sql, /select/i);
    assert.doesNotMatch(sql, /\b(insert|update|delete|alter|drop|truncate|create)\s+(into|table|from|public|private|auth)\b/i);
  }
  assert.match(READINESS_QUERIES.inventory, /raw_fifo_debts/);
  assert.match(READINESS_QUERIES.inventory, /raw_material_batches/);
  assert.match(READINESS_QUERIES.accounting, /journal_entry_lines/);
});

test('legacy account setup problems are reported without failing software integrity',()=>{
 const data=clean();
 data.accounts.active_without_auth=29;
 data.accounts.branches_without_members=3;
 const result=classifyReadiness(data);
 assert.equal(result.decision,'TECHNICAL_CHECKS_PASS');
 assert.equal(result.customer_data_decision,'CUSTOMER_DATA_REVIEW');
 assert.equal(result.checks.find(c=>c.id==='active_profiles_without_auth').status,'REVIEW');
});
test('actual database integrity failure still blocks technical readiness despite clean user records',()=>{
 const data=clean();data.integrity.orphan_payments=1;
 const result=classifyReadiness(data);
 assert.equal(result.decision,'NO_GO');
 assert.equal(result.customer_data_decision,'CUSTOMER_DATA_CLEAN');
});
