import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(async () => ({ data: { success: true }, error: null })) }));
vi.mock('@/api/rpc', () => ({ rpc: mocks.rpc }));
vi.mock('@/lib/posServiceDetails', () => ({ getPendingServiceDetails: () => null, clearPendingServiceDetails: vi.fn() }));
import { floorPlan } from '@/api/domains/floorPlan';
beforeEach(() => mocks.rpc.mockClear());
it('preserves the native delivery creation and uses revision protection only for an existing QR bill', async () => {
  await floorPlan.createOrder({ p_branch_id: 'branch', p_order_type: 'delivery', p_items: [] });
  expect(mocks.rpc).toHaveBeenLastCalledWith('create_service_order', { p_branch_id: 'branch', p_order_type: 'delivery', p_items: [], p_service_details: {} });
  await floorPlan.updateOrder({ p_order_id: 'order', p_order_type: 'delivery', p_qr_revision: 3, p_items: [] });
  expect(mocks.rpc).toHaveBeenLastCalledWith('qr_save_service_order', { p_revision: 3, p_payload: { p_order_id: 'order', p_order_type: 'delivery', p_items: [] }, p_details: null });
});
it('retains ordinary service updates for bills without QR additions', async () => {
  await floorPlan.updateOrder({ p_order_id: 'order', p_order_type: 'delivery', p_qr_revision: 0, p_items: [] });
  expect(mocks.rpc).toHaveBeenCalledWith('update_service_order', { p_order_id: 'order', p_order_type: 'delivery', p_items: [], p_service_details: null });
});
