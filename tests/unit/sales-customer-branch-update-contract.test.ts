import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20261123140000_sales_customer_branch_update_guard.sql', 'utf8');

describe('invoice customer reassignment stays in the same branch', () => {
  it('checks branch identity for any non-null customer on insert or update', () => {
    expect(sql).toContain('NEW.customer_id IS NOT NULL');
    expect(sql).toContain('c.id = NEW.customer_id AND c.branch_id = NEW.branch_id');
    expect(sql).toContain("RAISE EXCEPTION 'SALE_CUSTOMER_BRANCH_MISMATCH'");
  });
  it('enforces the check at the sales UPDATE boundary', () => {
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF customer_id, branch_id ON public.sales');
    expect(sql).toContain('FOR EACH ROW EXECUTE FUNCTION public.guard_sale_customer_branch_update()');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
  });
});
