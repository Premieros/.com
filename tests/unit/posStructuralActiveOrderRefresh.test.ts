import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const read = (path: string) => readFileSync(path, 'utf8');

describe('POS structural operations invalidate affected cashier workspace', () => {
  it('reports the affected source order only when merge or transfer commits', () => {
    const modal = read('src/features/pos/components/tables/TransferOrderModal.tsx');
    expect(modal).toContain("onOrderChanged?: (orderId: string, action: 'merge_order' | 'transfer_order') => void;");
    const commit = modal.indexOf('if (data?.success) {');
    const callback = modal.indexOf('onOrderChanged?.(order.id, actionType);', commit);
    const approval = modal.indexOf("data?.error === 'MANAGER_APPROVAL_REQUIRED'", commit);
    expect(commit).toBeGreaterThan(-1);
    expect(callback).toBeGreaterThan(commit);
    expect(approval).toBeGreaterThan(callback);
  });

  it('clears only the affected active cart and reloads table and order state', () => {
    const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');
    expect(workspace).toContain('onOrderChanged={(changedOrderId) => {');
    expect(workspace).toContain('if (pos.activeOrderId === changedOrderId) {');
    expect(workspace).toContain('pos.resetWorkspace();');
    expect(workspace).toContain('setReloadKey((value) => value + 1);');
  });
});