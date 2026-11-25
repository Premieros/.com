import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KitchenSendItem } from '@/features/pos/types';

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  local: vi.fn(),
  suppress: vi.fn(),
}));
vi.mock('@/features/pos/services/cloudPrint', () => ({
  enqueueCloudKitchenPrintJobs: mocks.enqueue,
}));
vi.mock('@/features/pos/services/localPrintAgent', () => ({
  groupKitchenItemsByStation: (items: KitchenSendItem[]) => items.reduce<Record<string, KitchenSendItem[]>>((groups, item) => {
    if (item.station_code) (groups[item.station_code] ??= []).push(item);
    return groups;
  }, {}),
  printKitchenStationsLocally: mocks.local,
  suppressNextKitchenBrowserPopup: mocks.suppress,
}));
import { dispatchKitchenStations } from '@/features/pos/services/kitchenDispatch';

const item = (station: string | null, id: string): KitchenSendItem => ({
  send_id: 'send-'+id, order_item_id: id, product_id: id, product_name: id,
  unit_name: 'piece', station_code: station, quantity: 1, current_quantity: 1,
  unit_price: 30, discount_amount: 0, bonus_quantity: 0, total: 30,
  notes: null,
});
const context = { isAr: false, orderNumber: 'BUNKER-ACCEPTANCE' };
const args = { orderId: 'order-demo', branchId: 'bunker', context };

describe('BUNKER kitchen/barista dispatch safety', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.local.mockResolvedValue(true); });
  it('queues mixed food and coffee to distinct stations without local duplicates', async () => {
    mocks.enqueue.mockResolvedValue({ queuedStations: ['kitchen','barista'] });
    const result = await dispatchKitchenStations({ ...args,
      items: [item('kitchen', 'burger'), item('barista', 'coffee')] });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.local).not.toHaveBeenCalled();
    expect(result.status).toBe('complete');
    expect(result.stations.map(s => s.station_code).sort()).toEqual(['barista','kitchen']);
    expect(result.stations.every(s => s.state === 'queued')).toBe(true);
  });
  it('uses the actual BUNKER station codes kit and بار without duplicate local tickets', async () => {
    mocks.enqueue.mockResolvedValue({ queuedStations: ['kit', 'بار'] });
    const items = [item('kit', 'burger'), item('بار', 'hot-coffee'), item('بار', 'iced-coffee')];
    const result = await dispatchKitchenStations({ ...args, items });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      branchId: 'bunker',
      items,
    }));
    expect(mocks.local).not.toHaveBeenCalled();
    expect(result.status).toBe('complete');
    expect(result.stations).toEqual(expect.arrayContaining([
      expect.objectContaining({ station_code: 'kit', item_count: 1, state: 'queued' }),
      expect.objectContaining({ station_code: 'بار', item_count: 2, state: 'queued' }),
    ]));
    expect(result.stations).toHaveLength(2);
    expect(result.failed_stations).toEqual([]);
  });
  it('falls back only for the BUNKER barista when kitchen kit is cloud-queued', async () => {
    mocks.enqueue.mockResolvedValue({ queuedStations: ['kit'] });
    const result = await dispatchKitchenStations({ ...args, items: [
      item('kit', 'burger'), item('بار', 'coffee'),
    ] });
    expect(result.status).toBe('complete');
    expect(mocks.local).toHaveBeenCalledTimes(1);
    expect(mocks.local.mock.calls[0][0]).toEqual([
      expect.objectContaining({ station_code: 'بار' }),
    ]);
  });
  it('falls back only for a station not accepted by cloud', async () => {
    mocks.enqueue.mockResolvedValue({ queuedStations: ['kitchen'] });
    const result = await dispatchKitchenStations({ ...args,
      items: [item('kitchen','burger'), item('barista','coffee')] });
    expect(mocks.local).toHaveBeenCalledTimes(1);
    expect(mocks.local.mock.calls[0][0]).toEqual([expect.objectContaining({ station_code:'barista' })]);
    expect(result.status).toBe('complete');
  });
  it('reports failed barista delivery rather than claiming success', async () => {
    mocks.enqueue.mockResolvedValue({ queuedStations: ['kitchen'] });
    mocks.local.mockResolvedValue(false);
    const result = await dispatchKitchenStations({ ...args,
      items: [item('kitchen','burger'), item('barista','coffee')] });
    expect(result.status).toBe('partial');
    expect(result.failed_stations).toEqual(['barista']);
  });
  it('treats missing station assignment as a delivery failure', async () => {
    mocks.enqueue.mockResolvedValue({ queuedStations: ['kitchen'] });
    const result = await dispatchKitchenStations({ ...args,
      items: [item('kitchen','burger'), item(null,'unassigned')] });
    expect(result.status).toBe('partial');
    expect(result.missing_station_items).toBe(1);
  });
  it('does not dispatch an empty send', async () => {
    const result = await dispatchKitchenStations({ ...args, items: [] });
    expect(result.status).toBe('not_needed');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
