import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrderSettlementPreview } from '@/features/pos/services/settlementPreview';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/pos/services/settlementPreview', () => ({
  fetchOrderSettlementPreview: fetchMock,
}));
import { useScopedSettlementPreview } from '@/features/pos/hooks/useScopedSettlementPreview';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function preview(order: string, branch: string): OrderSettlementPreview {
  return {
    success: true, order_id: order, branch_id: branch, warehouse_id: null,
    items: [], subtotal: 10, discount_amount: 0, discount_type: 'amount',
    tax_amount: 0, total: 10, pending_quantity: 0, unsent_quantity: 0,
    has_payable_items: true,
  };
}
const response = (value: OrderSettlementPreview) => ({ preview: value, error: null });

describe('scoped POS settlement previews', () => {
  afterEach(() => fetchMock.mockReset());

  it('never installs an earlier order preview after the operator switches orders', async () => {
    const first = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(response(preview('order-b', 'branch-a')));
    const { result, rerender } = renderHook(
      ({ order, branch }) => useScopedSettlementPreview(order, branch),
      { initialProps: { order: 'order-a', branch: 'branch-a' } },
    );
    let oldLoad!: ReturnType<typeof result.current.load>;
    act(() => { oldLoad = result.current.load(); });
    rerender({ order: 'order-b', branch: 'branch-a' });
    let newLoad!: ReturnType<typeof result.current.load>;
    act(() => { newLoad = result.current.load(); });
    await act(async () => { await newLoad; });
    expect(result.current.preview?.order_id).toBe('order-b');
    await act(async () => {
      first.resolve(response(preview('order-a', 'branch-a')));
      expect((await oldLoad).preview).toBeNull();
    });
    expect(result.current.preview?.order_id).toBe('order-b');
  });

  it('refuses a preview carrying the wrong branch even when requested order matches', async () => {
    fetchMock.mockResolvedValue(response(preview('order-a', 'branch-b')));
    const { result } = renderHook(() => useScopedSettlementPreview('order-a', 'branch-a'));
    let loaded: Awaited<ReturnType<typeof result.current.load>> | undefined;
    await act(async () => { loaded = await result.current.load(); });
    expect(loaded?.error).toBe('SETTLEMENT_PREVIEW_SCOPE_MISMATCH');
    expect(result.current.preview).toBeNull();
  });

  it('clears a checkout preview and makes the previous snapshot unusable', async () => {
    fetchMock.mockResolvedValue(response(preview('order-a', 'branch-a')));
    const { result } = renderHook(() => useScopedSettlementPreview('order-a', 'branch-a'));
    await act(async () => { await result.current.load(); });
    await waitFor(() => expect(result.current.preview?.total).toBe(10));
    const earlier = result.current.preview!;
    act(() => { result.current.clear(); });
    expect(result.current.preview).toBeNull();
    expect(result.current.isCurrent(earlier)).toBe(false);
  });

  it('blocks a superseded request within the same order and branch', async () => {
    const old = deferred<ReturnType<typeof response>>();
    const fresh = response(preview('order-a', 'branch-a'));
    fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(fresh);
    const { result } = renderHook(() => useScopedSettlementPreview('order-a', 'branch-a'));
    let stale!: ReturnType<typeof result.current.load>;
    act(() => { stale = result.current.load(); });
    await act(async () => { await result.current.load(); });
    await act(async () => {
      old.resolve(response(preview('order-a', 'branch-a')));
      expect((await stale).preview).toBeNull();
    });
    expect(result.current.preview).toBe(fresh.preview);
  });
});
