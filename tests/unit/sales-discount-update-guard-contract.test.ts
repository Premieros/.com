import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20261123120000_guard_sales_discount_updates.sql', 'utf8',
);

describe('discount UPDATE permission guard migration', () => {
  it('guards discount changes rather than unrelated invoice updates', () => {
    expect(sql).toContain('BEFORE UPDATE OF discount_amount ON public.sales');
    expect(sql).toContain('NEW.discount_amount IS DISTINCT FROM OLD.discount_amount');
  });

  it('requires discount authority for an updated positive discount', () => {
    expect(sql).toContain("public.can_permission('pos.discount')");
    expect(sql).toContain('public.is_pos_admin()');
    expect(sql).toContain("RAISE EXCEPTION 'DISCOUNT_NOT_ALLOWED'");
  });

  it('does not expose the trigger function to clients or change financial RPCs', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.guard_sale_discount_update() FROM PUBLIC, anon, authenticated');
    expect(sql).not.toContain('GRANT EXECUTE');
    expect(sql).not.toContain('DROP POLICY');
  });
});
