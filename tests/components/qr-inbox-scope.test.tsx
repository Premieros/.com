import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ inbox: vi.fn(), decide: vi.fn(), navigate: vi.fn(), can: () => true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => mocks.can }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/features/qr/service', () => ({ qrInbox: mocks.inbox, qrDecide: mocks.decide, qrError: () => 'Unavailable' }));
import { QrInbox } from '@/features/qr/QrInbox';

describe('QR inbox branch scope', () => {
  beforeEach(() => { cleanup(); mocks.inbox.mockReset(); mocks.decide.mockReset(); mocks.navigate.mockReset(); });
  it('does not navigate back to an old branch when an acceptance finishes after switching', async () => {
    mocks.inbox.mockResolvedValue([{ id: 'request', table_name: 'Table A', items: [], created_at: '2026-11-14T00:00:00Z' }]);
    let done: (value: unknown) => void = () => undefined;
    mocks.decide.mockImplementation(() => new Promise(resolve => { done = resolve; }));
    const view = render(<QrInbox key="a" branchId="a" />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1'));
    fireEvent.click(screen.getByRole('button', { name: /طلبات QR/ }));
    fireEvent.click(screen.getByRole('button', { name: 'قبول وفتح الفاتورة' }));
    expect(mocks.decide).toHaveBeenCalledWith('request', true);
    mocks.inbox.mockResolvedValue([]);
    view.rerender(<QrInbox key="b" branchId="b" />);
    done({ order_id: 'old-order', status: 'accepted' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('0'));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
