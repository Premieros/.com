import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CashierDiscountApprovalCard } from '@/features/pos/components/checkout/CashierDiscountApprovalCard';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}));
vi.mock('@/api', () => ({ supabase: mocks }));

type StatusEvent = (payload: { new: { status: string } }) => void;

describe('cashier discount approval recovery', () => {
  let events: StatusEvent[];
  let readStatus: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    events = [];
    readStatus = vi.fn().mockResolvedValue({ data: { status: 'pending' }, error: null });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: readStatus }) }) });
    mocks.channel.mockImplementation(() => ({
      on: (_event: string, _filter: unknown, cb: StatusEvent) => {
        events.push(cb);
        return { subscribe: (callback: (state: string) => void) => { callback('SUBSCRIBED'); return {}; } };
      },
    }));
    mocks.rpc.mockResolvedValue({ data: { success: true, request_id: 'approval-1' }, error: null });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  const props = (onApproved = vi.fn(), subtotal = 100) => ({
    subtotal, currentType: 'amount' as const, onApproved, ar: false, canDirectDiscount: false,
  });
  function request() {
    fireEvent.change(screen.getByPlaceholderText('Discount'), { target: { value: '20' } });
    fireEvent.change(screen.getByPlaceholderText('Reason (required)'), { target: { value: 'Manager review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send approval request' }));
  }

  it('recovers an approval already recorded before Realtime subscription and applies it once', async () => {
    readStatus.mockResolvedValue({ data: { status: 'approved' }, error: null });
    const onApproved = vi.fn();
    render(<CashierDiscountApprovalCard {...props(onApproved)} />);
    request();
    await waitFor(() => expect(onApproved).toHaveBeenCalledWith('amount', 20));
    act(() => events[0]({ new: { status: 'approved' } }));
    expect(onApproved).toHaveBeenCalledTimes(1);
  });

  it('rejects the approval if the subtotal changes while awaiting the manager', async () => {
    const onApproved = vi.fn();
    const view = render(<CashierDiscountApprovalCard {...props(onApproved)} />);
    request();
    await waitFor(() => expect(events.length).toBe(1));
    view.rerender(<CashierDiscountApprovalCard {...props(onApproved, 200)} />);
    act(() => events[0]({ new: { status: 'approved' } }));
    expect(onApproved).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Order subtotal changed');
  });

  it('requests a persisted order explicitly and rejects an approval after switching orders', async () => {
    const onApproved = vi.fn();
    const view = render(<CashierDiscountApprovalCard {...props(onApproved)} branchId="branch-a" orderId="order-a" />);
    request();
    await waitFor(() => expect(events.length).toBe(1));
    expect(mocks.rpc).toHaveBeenCalledWith('request_manager_approval', expect.objectContaining({
      p_entity_type: 'order', p_entity_id: 'order-a',
      p_payload: expect.objectContaining({ branch_id: 'branch-a', discount_amount: 20, discount_type: 'amount' }),
    }));
    view.rerender(<CashierDiscountApprovalCard {...props(onApproved)} branchId="branch-a" orderId="order-b" />);
    act(() => events[0]({ new: { status: 'approved' } }));
    expect(onApproved).not.toHaveBeenCalled();
  });

  it('rejects a different cart at the same subtotal', async () => {
    const onApproved = vi.fn();
    const line = { product_id: 'a', unit_name: 'piece', quantity: 1, unit_price: 100, discount_amount: 0, bonus_quantity: 0, total: 100, modifier_option_ids: [] };
    const view = render(<CashierDiscountApprovalCard {...props(onApproved)} cart={[line]} />);
    request();
    await waitFor(() => expect(events.length).toBe(1));
    expect(mocks.rpc).toHaveBeenCalledWith('request_manager_approval', expect.objectContaining({
      p_payload: expect.objectContaining({ cart: [line], discount_type: 'amount' }),
    }));
    view.rerender(<CashierDiscountApprovalCard {...props(onApproved)} cart={[{ ...line, product_id: 'b' }]} />);
    act(() => events[0]({ new: { status: 'approved' } }));
    expect(onApproved).not.toHaveBeenCalled();
  });

  it('shows request failure and permits a retry without applying a discount', async () => {
    const onApproved = vi.fn();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Request unavailable' } });
    render(<CashierDiscountApprovalCard {...props(onApproved)} />);
    request();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Request unavailable'));
    expect(onApproved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send approval request' }));
    await waitFor(() => expect(events.length).toBe(1));
  });

  it('unlocks the form when the pending request has expired without a Realtime update', async () => {
    const onApproved = vi.fn();
    readStatus.mockResolvedValue({ data: { status: 'pending', expires_at: '2000-01-01T00:00:00Z' }, error: null });
    render(<CashierDiscountApprovalCard {...props(onApproved)} />);
    request();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rejected' })).toBeTruthy());
    expect(onApproved).not.toHaveBeenCalled();
  });

  it('ignores delayed approved events from a rejected request after a new request starts', async () => {
    const onApproved = vi.fn();
    render(<CashierDiscountApprovalCard {...props(onApproved)} />);
    request();
    await waitFor(() => expect(events.length).toBe(1));
    act(() => events[0]({ new: { status: 'rejected' } }));
    mocks.rpc.mockResolvedValue({ data: { success: true, request_id: 'approval-2' }, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Rejected' }));
    await waitFor(() => expect(events.length).toBe(2));
    act(() => events[0]({ new: { status: 'approved' } }));
    expect(onApproved).not.toHaveBeenCalled();
    act(() => events[1]({ new: { status: 'approved' } }));
    expect(onApproved).toHaveBeenCalledTimes(1);
  });
});
