#!/usr/bin/env node
// Offline release handoff gate: no DB connection, writes, or external calls.
// Usage: node scripts/readiness/evaluate-handoff.mjs readiness-audit.json evidence.json
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const REQUIRED_EVIDENCE = [
  'restore_rehearsal',
  'cashier_sale_refund_shift',
  'concurrent_retry_idempotency',
  'tenant_role_isolation',
  'security_rpc_review',
  'inventory_negative_balance_signoff',
  'device_offline_online',
  'operations_rollback_monitoring'
];

export function evaluateHandoff(audit, evidence) {
  if (!audit || typeof audit !== 'object' || !Array.isArray(audit.checks))
    throw Error('INVALID_AUDIT');
  if (audit.project_ref !== 'hvqlkapynjfjikqithvd')
    throw Error('WRONG_PROJECT');
  const checks = audit.checks;
  if (checks.some(c => !['PASS','REVIEW','BLOCKER'].includes(c.status)))
    throw Error('INVALID_CHECK');
  const blocking = checks.filter(c => c.status === 'BLOCKER' || c.status === 'REVIEW').map(c => c.id);
  const incomplete = REQUIRED_EVIDENCE.filter(name => {
    const record = evidence?.[name];
    return !record || record.result !== 'PASS' ||
      typeof record.owner !== 'string' || !record.owner.trim() ||
      typeof record.reference !== 'string' || !record.reference.trim() ||
      typeof record.checked_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(record.checked_at);
  });
  return {
    decision: blocking.length === 0 && incomplete.length === 0 &&
      audit.decision === 'TECHNICAL_CHECKS_PASS' ? 'DELIVERY_GATE_PASS' : 'NOT_READY',
    project_ref:audit.project_ref,
    blocking_checks:blocking,
    missing_evidence:incomplete,
    // Passing this gate documents evidence; it never authorizes database writes.
    production_mutations_authorized:false
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const [auditPath, evidencePath] = process.argv.slice(2);
    if (!auditPath || !evidencePath) throw Error('INPUT_FILES_REQUIRED');
    const [audit, evidence] = await Promise.all([auditPath,evidencePath].map(async p=>JSON.parse(await readFile(p,'utf8'))));
    const result = evaluateHandoff(audit,evidence);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    process.exitCode = result.decision === 'DELIVERY_GATE_PASS' ? 0 : 2;
  } catch {
    process.stderr.write('HANDOFF_EVALUATION_FAILED\n');
    process.exitCode = 1;
  }
}
