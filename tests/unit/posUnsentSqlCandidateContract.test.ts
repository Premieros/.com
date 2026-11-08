import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.join(process.cwd(),
  'scripts/db/candidates/pos_unsent_settlement_print_NOT_FOR_PRODUCTION.sql'), 'utf8');

describe('Premier POS server guard candidate safety contract', () => {
  it('is explicitly staged, transaction-wrapped and locked to known function definitions', () => {
    expect(sql).toContain('NOT FOR PRODUCTION');
    expect(sql).toContain("SET LOCAL lock_timeout = '2s'");
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).toContain('7bd3f7ac00ec8fd217bf27be451c1a73');
    expect(sql).toContain('79d0a8973a55b7e85ea6655c3df53f90');
    expect(sql).toContain('PREMIER_SETTLEMENT_BASELINE_DRIFT');
    expect(sql).toContain('PREMIER_PRINT_BASELINE_DRIFT');
    expect(sql).toContain('PREMIER_PRINT_ANCHOR_DRIFT');
  });

  it('guards both settlement and print against missing or partially sent lines', () => {
    expect(sql.match(/PREMIER_ORDER_FULL_SEND_REQUIRED_20261108/g)?.length).toBe(3);
    expect(sql.match(/ORDER_NOT_FULLY_SENT/g)?.length).toBe(2);
    expect(sql.match(/COALESCE\(s\.sent_quantity, 0\) \+ 0\.000001/g)?.length).toBe(2);
    expect(sql.match(/s\.order_id = oi\.order_id/g)?.length).toBe(2);
    expect(sql).toContain('WHERE o.id=p_order_id\n  FOR UPDATE;');
    expect(sql).toContain('user_may_access_branch');
    expect(sql).toContain('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('contains no transaction data-repair statements or financial replay', () => {
    expect(sql).not.toMatch(/\b(?:INSERT INTO|UPDATE public|DELETE FROM|TRUNCATE|DROP TABLE)\b/i);
    expect(sql).not.toContain('SET row_security = off');
    expect(sql).not.toContain('GRANT EXECUTE');
  });
});
