import { describe, expect, it } from 'vitest';
import { requireOfflineSaleOwner } from '@/core/offline/requireOfflineSaleOwner';
import { getUnrecordedQueuedSaleDeductions } from '@/core/repositories/stockProjection';
import type { LocalStockMovement } from '@/core/repositories/types';
import type { OfflineSaleQueueItem } from '@/core/offline/offlineStorage';

const sale = (
  invoice: string,
  branch: string,
  items: Array<{ product_id: string; quantity: number }>,
  id = invoice,
): OfflineSaleQueueItem => ({
  id, client_id: id, invoice_number: invoice, created_at: '2026-10-13T00:00:00Z',
  payload: { p_invoice_number: invoice, p_branch_id: branch, p_items: items },
  status: 'pending', retry_count: 0, created_by_user_id: 'operator-1',
});
const movement = (invoice: string, branch: string, product: string, qty: number,
  overrides: Partial<LocalStockMovement> = {}): LocalStockMovement => ({
  id: invoice + '-' + branch + '-' + product, productId: product, branchId: branch,
  quantityDelta: -qty, reason: 'sale', referenceId: invoice,
  createdAt: '2026-10-13T00:00:00Z', synced: false, ...overrides,
});

describe('offline sale identity and per-product stock replay', () => {
  it('requires the original signed-in cashier before adding financial outbox records', () => {
    expect(requireOfflineSaleOwner({ user: { id: ' operator-1 ' } })).toBe('operator-1');
    expect(() => requireOfflineSaleOwner(null)).toThrow('AUTH_REQUIRED_OFFLINE_SALE_OWNER');
    expect(() => requireOfflineSaleOwner({user:{id:' '}})).toThrow('AUTH_REQUIRED_OFFLINE_SALE_OWNER');
  });

  it('counts missing movements for only the absent item of a multi-item invoice', () => {
    const s = sale('INV-1','branch-a',[{product_id:'prod-a',quantity:2},{product_id:'prod-b',quantity:3}]);
    expect(getUnrecordedQueuedSaleDeductions('branch-a',[s],[movement('INV-1','branch-a','prod-a',2)]))
      .toEqual({'prod-b':3});
  });

  it('counts only the unrecorded remainder of a partially written movement', () => {
    const s = sale('INV-2','branch-a',[{product_id:'prod-a',quantity:5}]);
    expect(getUnrecordedQueuedSaleDeductions('branch-a',[s],[movement('INV-2','branch-a','prod-a',2)]))
      .toEqual({'prod-a':3});
  });

  it('does not duplicate deductions when all sale movements already exist', () => {
    const s = sale('INV-3','branch-a',[{product_id:'prod-a',quantity:2},{product_id:'prod-b',quantity:1}]);
    expect(getUnrecordedQueuedSaleDeductions('branch-a',[s],[
      movement('INV-3','branch-a','prod-a',2),
      movement('INV-3','branch-a','prod-b',1),
    ])).toEqual({});
  });

  it('never uses a matching invoice from another branch to suppress a deduction', () => {
    const s = sale('INV-4','branch-a',[{product_id:'prod-a',quantity:2}]);
    expect(getUnrecordedQueuedSaleDeductions('branch-a',[s],[
      movement('INV-4','branch-b','prod-a',2),
    ])).toEqual({'prod-a':2});
  });

  it('does not use unrelated adjustment or synchronized movements to suppress queued sales', () => {
    const s = sale('INV-5','branch-a',[{product_id:'prod-a',quantity:2}]);
    expect(getUnrecordedQueuedSaleDeductions('branch-a',[s],[
      movement('INV-5','branch-a','prod-a',2,{reason:'adjustment'}),
      movement('INV-5','branch-a','prod-a',2,{synced:true,id:'other'}),
    ])).toEqual({'prod-a':2});
  });

  it('ignores other branches, confirmed sales and malformed/zero input quantities', () => {
    const s = sale('INV-6','branch-a',[{product_id:'prod-a',quantity:2}]);
    const other = sale('INV-7','branch-b',[{product_id:'prod-a',quantity:7}]);
    const completed = {...sale('INV-8','branch-a',[{product_id:'prod-a',quantity:8}]),status:'synced' as const};
    const bad = sale('INV-9','branch-a',[{product_id:'prod-a',quantity:0}]);
    expect(getUnrecordedQueuedSaleDeductions('branch-a',[s,other,completed,bad],[]))
      .toEqual({'prod-a':2});
  });

  it('handles repeated product lines and local-ID movements', () => {
    const s=sale('INV-10','branch-a',[{product_id:'prod-a',quantity:2},{product_id:'prod-a',quantity:3}],'local-10');
    expect(getUnrecordedQueuedSaleDeductions('branch-a',[s],[
      movement('local-10','branch-a','prod-a',4),
    ])).toEqual({'prod-a':1});
  });
});
