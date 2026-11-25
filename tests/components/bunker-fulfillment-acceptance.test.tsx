import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { GuestBill, GuestTracking } from '@/features/qr/service';

vi.mock('@/api/domains/qrPublic', () => ({ qrPublic: { guestCall: vi.fn(), callService: vi.fn() } }));
import { GuestVisitPanel } from '@/features/qr/GuestVisitPanel';

const token = '3236a6be44494d89ba2b2a4e7c55fb140564f5a6ae5f4db7bcd7ace6eadeaf62';
const props = { token, session: 'a'.repeat(64), table: 'table-1', currency: 'EGP',
  error: '', refresh: vi.fn(async () => {}), newVisit: vi.fn(), secure: true };

function bill(overrides: Partial<GuestBill> = {}): GuestBill {
  return { id: 'order-1', order_number: 'BUNKER-TEST-1', status: 'open',
    kitchen_status: 'pending', payment_status: 'unpaid', table_id: 'table-1',
    table_name: 'Table 1', subtotal: 100, discount_amount: 0,
    discount_type: 'amount', tax_amount: 0, total: 100, paid_amount: 0,
    refunded_amount: 0, balance: 100,
    items: [{ name: 'Demo item', quantity: 1, unit_price: 100, total: 100 }],
    ...overrides };
}
function visit(type: 'dine_in' | 'delivery' | 'pickup',
  overrides: Partial<GuestBill> = {}): GuestTracking {
  return { visit: { id: 'visit-1', order_type: type, table_id: type === 'dine_in' ? 'table-1' : null,
    table_name: type === 'dine_in' ? 'Table 1' : '', has_request: true,
    status: 'active', pin_set: false },
    requests: [], bills: [bill(overrides)], calls: [] };
}

describe('BUNKER customer tracking acceptance — browser presentation', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });
  it('tracks kitchen preparation for a dine-in table without implying it was served', () => {
    render(<GuestVisitPanel {...props} tracking={visit('dine_in', { kitchen_status: 'cooking' })} />);
    expect(screen.getByText(/Dine in · Preparing/)).toBeInTheDocument();
    expect(screen.queryByText(/Dine in · Served/)).not.toBeInTheDocument();
  });
  it('shows a pickup as ready for pickup only when all items have been sent', () => {
    const view = render(<GuestVisitPanel {...props} tracking={visit('pickup',
      { kitchen_status: 'ready', has_unsent: false })} />);
    expect(screen.getByText(/Pickup · Ready for pickup/)).toBeInTheDocument();
    view.rerender(<GuestVisitPanel {...props} tracking={visit('pickup',
      { kitchen_status: 'ready', has_unsent: true })} />);
    expect(screen.getByText(/Pickup · Waiting for preparation/)).toBeInTheDocument();
    expect(screen.queryByText(/Pickup · Ready for pickup/)).not.toBeInTheDocument();
  });
  it('shows courier dispatch independently of kitchen status', () => {
    render(<GuestVisitPanel {...props} tracking={visit('delivery',
      { kitchen_status: 'ready', dispatch_status: 'on_the_way', has_unsent: false })} />);
    expect(screen.getByText(/Delivery · On the way/)).toBeInTheDocument();
    expect(screen.queryByText(/Delivery · Ready for delivery/)).not.toBeInTheDocument();
  });
  it('keeps an accepted but unsent order visible as awaiting kitchen', () => {
    render(<GuestVisitPanel {...props} tracking={visit('dine_in',
      { kitchen_status: 'pending', has_unsent: true })} />);
    expect(screen.getByText(/Dine in · Waiting for preparation/)).toBeInTheDocument();
  });
});
