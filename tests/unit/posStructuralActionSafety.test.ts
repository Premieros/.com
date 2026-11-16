import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const read = (path: string) => readFileSync(path, 'utf8');

describe('POS structural order operations route through approved server actions', () => {
  it('removes obsolete three-write direct order/table move, preventing partial client commits', () => {
    const base = read('src/features/pos/hooks/usePosOrderBase.ts');
    expect(base).not.toContain('const transferOrderToTable = useCallback');
    expect(base).not.toContain('transferOrderToTable,');
    expect(base).not.toContain(".update({ table_id: toTableId");
    expect(base).not.toContain(".update({ status: 'vacant', updated_at");
    const page = read('src/features/pos/pages/PosWorkspacePage.tsx');
    expect(page).not.toContain('handleConfirmTransfer');
    expect(page).not.toContain('onConfirmTransfer=');
  });

  it('keeps whole-order transfer and merge in the manager approval RPC', () => {
    const modal = read('src/features/pos/components/tables/TransferOrderModal.tsx');
    expect(modal).toContain("const actionType = targetHasOrder ? 'merge_order' : 'transfer_order'");
    expect(modal).toContain('api.pos.performOrderAction({');
    expect(modal).toContain('p_reason: reason.trim()');
    expect(modal).toContain("data?.error === 'MANAGER_APPROVAL_REQUIRED'");
    expect(modal).toContain("data?.error === 'SOURCE_HAS_SENT_ITEMS'");
    expect(modal).toContain('onOrderChanged?.();');
  });

  it('refreshes order and table snapshots only after successful structural action', () => {
    const page = read('src/features/pos/pages/PosWorkspacePage.tsx');
    const modal = read('src/features/pos/components/tables/TransferOrderModal.tsx');
    expect(page).toContain('onOrderChanged={() => setReloadKey((value) => value + 1)}');
    const success = modal.indexOf('if (data?.success) {');
    expect(success).toBeGreaterThan(0);
    expect(modal.indexOf('onOrderChanged?.();', success)).toBeGreaterThan(success);
    expect(modal.indexOf("data?.error === 'MANAGER_APPROVAL_REQUIRED'", success))
      .toBeGreaterThan(modal.indexOf('onOrderChanged?.();', success));
  });
});
