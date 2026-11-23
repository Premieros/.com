import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20261123130000_limit_direct_sales_update_columns.sql', 'utf8');

describe('sales direct write least privilege', () => {
  it('revokes broad UPDATE and limits client mutations to nonfinancial metadata', () => {
    expect(sql).toContain('REVOKE UPDATE ON TABLE public.sales FROM authenticated');
    expect(sql).toContain('GRANT UPDATE (customer_id, notes) ON TABLE public.sales TO authenticated');
    expect(sql).not.toContain('GRANT UPDATE (status');
    expect(sql).not.toContain('GRANT UPDATE (source_order_id');
  });

  it('removes TRUNCATE, which cannot be limited by row-level security', () => {
    expect(sql).toContain('REVOKE TRUNCATE ON TABLE public.sales FROM authenticated');
  });

  it('preserves the existing settlement source-order trigger through owner execution', () => {
    expect(sql).toContain('ALTER FUNCTION public.sync_sale_source_order_from_kitchen_event()');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path = 'public', 'pg_temp'");
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
  });
});
