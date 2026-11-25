import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { KitchenDisplayPage } from '@/features/inventory/pages/KitchenDisplayPage';

const state = vi.hoisted(() => ({
  userId: 'cook-a',
  branchId: 'branch-a',
  canView: true,
  rpc: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: state.userId } }) }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en' }) }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => state.branchId }));
vi.mock('@/lib/permissions', () => ({ useCan: () => (permission: string) => state.canView && permission === 'pos.kds_view' }));
vi.mock('@/api', () => ({ supabase: { rpc: state.rpc } }));
vi.mock('@/api/domains/catalog', () => ({
  catalog: { getKitchenOrderContext: async () => ({ data: [], error: null }) },
}));
vi.mock('@/features/pos/services/posRealtime', () => ({ subscribePosRealtime: () => () => {} }));
vi.mock('@/features/qr/useQrNotificationTone', () => ({
  useQrNotificationTone: () => ({ ready: true, unlock: async () => {} }),
}));
vi.mock('@/features/inventory/components/KitchenCompletedHistory', () => ({
  KitchenCompletedHistory: () => null,
}));

function ticket(number: string) {
  return { order_id: number, order_number: number, kitchen_status: 'sent', station: 'kit', items: [], elapsed_seconds: 0 };
}

it('discards old branch and account cards even while newer reads are pending', async () => {
  type QueueResponse = { data: ReturnType<typeof ticket>[]; error: null };
  const pending = new Map<string, (response: QueueResponse) => void>();
  state.rpc.mockImplementation((name: string) => {
    if (name === 'get_kitchen_queue') {
      if (state.branchId === 'branch-a') return Promise.resolve({ data: [ticket('old-branch')], error: null });
      return new Promise<QueueResponse>(resolve => pending.set(state.userId, resolve));
    }
    const data = name === 'get_kitchen_transfer_notices' ? { success: true, rows: [] } : [];
    return Promise.resolve({ data, error: null });
  });
  const { rerender } = render(<KitchenDisplayPage />);
  expect(await screen.findByText('#old-branch')).toBeTruthy();

  state.branchId = 'branch-b';
  rerender(<KitchenDisplayPage />);
  expect(screen.queryByText('#old-branch')).toBeNull();
  await waitFor(() => expect(pending.has('cook-a')).toBe(true));

  state.userId = 'cook-b';
  rerender(<KitchenDisplayPage />);
  await waitFor(() => expect(pending.has('cook-b')).toBe(true));
  await act(async () => {
    pending.get('cook-a')?.({ data: [ticket('old-account')], error: null });
    pending.get('cook-b')?.({ data: [ticket('current-account')], error: null });
  });
  expect(screen.queryByText('#old-account')).toBeNull();
  expect(screen.getByText('#current-account')).toBeTruthy();

  state.canView = false;
  rerender(<KitchenDisplayPage />);
  expect(screen.queryByText('#current-account')).toBeNull();
});
