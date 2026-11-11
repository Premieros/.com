import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261111110000_require_open_shift_for_order_settlement.sql'),
  'utf8',
);
describe('all-role linked-order settlement requires active branch shift', () => {
  it('protects both standard and split sale entry points (including admin flows)', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.process_sale(');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.process_sale_split(');
    expect((sql.match(/IF p_order_id IS NOT NULL THEN\s*IF p_shift_id IS NULL THEN/g) ?? [])).toHaveLength(2);
    expect((sql.match(/FOR SHARE;/g) ?? [])).toHaveLength(2);
    expect((sql.match(/s\.status='open'/g) ?? [])).toHaveLength(2);
    expect((sql.match(/s\.branch_id=p_branch_id/g) ?? [])).toHaveLength(2);
  });
  it('does not schedule jobs or directly rewrite sale and inventory history', () => {
    expect(sql).not.toMatch(/cron\.schedule\s*\(/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+public\.(?:orders|sales|inventory_ledger)\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+public\.(?:orders|sales|journal_entries)\b/i);
  });
});