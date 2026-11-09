import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static release guard: functional rollback must additionally be verified in an
// isolated local PostgreSQL/Supabase fixture before this migration is deployed.
const migration = readFileSync('supabase/migrations/20261109140000_premier_stock_count_atomic_failures.sql', 'utf8');
const kds = readFileSync('src/features/inventory/pages/KitchenDisplayPage.tsx', 'utf8');
const kdsAccess = readFileSync('supabase/migrations/20261109143000_premier_kds_read_only_permissions.sql', 'utf8');
const catalog = readFileSync('src/api/domains/catalog.ts', 'utf8');

describe('Premier operational parity safety guards', () => {
  it('preserves the Premier stock count movement/accounting writers', () => {
    expect(migration).toContain('private.apply_unified_raw_movement_v1');
    expect(migration).toContain('private.remove_product_stock_non_fifo_v1');
    expect(migration).toContain('public._post_journal_entry');
    expect(migration).toContain("public.can_permission('inventory.count.apply')");
    expect(migration).toContain('public.user_may_access_branch(v_count.branch_id)');
  });

  it('aborts and rolls back every post-write JSON error, never returning inside the item loop', () => {
    const itemLoop = migration.split('    FOR v_item IN')[1]?.split('    END LOOP;')[0] ?? '';
    expect(itemLoop).toBeTruthy();
    expect(itemLoop).not.toMatch(/RETURN\s+jsonb_build_object\s*\(\s*'success',\s*false/i);
    expect((itemLoop.match(/RAISE EXCEPTION 'STOCK_COUNT_ABORT'/g) ?? [])).toHaveLength(4);
    expect(migration).toContain("IF SQLERRM = 'STOCK_COUNT_ABORT' AND v_failure IS NOT NULL THEN");
    expect(migration).toContain('RETURN v_failure;');
    expect(migration).toContain("RAISE EXCEPTION 'PREMIER_COUNT_WRITER_DRIFT");
  });

  it('refreshes kitchen cards without changing orders or completing aged work', () => {
    expect(kds).not.toContain('catalog.completeStaleKitchenOrders(');
    expect(catalog).not.toContain('completeStaleKitchenOrders(');
    expect(kds).toContain("supabase.rpc('get_kitchen_queue'");
    expect(kds).toContain('item.elapsed_seconds >= 2400');
    expect(kds).toContain('pendingStatusWrites.has(item.order_id)');
    expect(kds).toContain('statusWritesRef.current.has(orderId)');
    expect(kds).toContain("can('pos.kds_update')");
    expect(kdsAccess).toContain('REVOKE EXECUTE ON FUNCTION public.complete_stale_kitchen_orders(uuid) FROM authenticated');
    expect(kdsAccess).toContain('GRANT EXECUTE ON FUNCTION public.complete_stale_kitchen_orders(uuid) TO service_role');
  });
});
