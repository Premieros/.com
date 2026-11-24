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
