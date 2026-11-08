import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const subscription = { callback: null as null | ((status: string) => void) };
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockImplementation((callback: (status: string) => void) => {
    subscription.callback = callback;
    return channel;
  });
  return {
    subscription,
    channel,
    removeChannel: vi.fn().mockResolvedValue(undefined),
    rpc: vi.fn(),
    from: vi.fn(),
  };
});

vi.mock('@/api', () => ({
  supabase: {
    channel: () => mocks.channel,
    removeChannel: mocks.removeChannel,
    rpc: mocks.rpc,
    from: mocks.from,
  },
  pos: {},
}));

import { fetchOrderForWorkspace } from '@/features/pos/services/posOrders';
import { subscribePosRealtime } from '@/features/pos/services/posRealtime';

describe('Premier POS recovery and terminal order safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    mocks.channel.on.mockClear();
    mocks.channel.subscribe.mockClear();
    mocks.removeChannel.mockClear();
    mocks.subscription.callback = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const status of ['completed', 'cancelled']) {
    it(`blocks hydration of a ${status} order after permission was granted`, async () => {
      mocks.rpc.mockResolvedValue({ data: { success: true }, error: null });
      const maybeSingle = vi.fn().mockResolvedValue({
        data: { id: 'order-1', branch_id: 'branch-1', status },
        error: null,
      });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      const select = vi.fn().mockReturnValue({ eq });
      mocks.from.mockReturnValue({ select });

      await expect(fetchOrderForWorkspace('order-1'))
        .rejects.toThrow(status === 'completed' ? 'ORDER_CLOSED' : 'ORDER_CANCELLED');
      expect(mocks.from).toHaveBeenCalledTimes(1);
      expect(mocks.from).toHaveBeenCalledWith('orders');
      expect(mocks.rpc).toHaveBeenCalledWith('authorize_pos_order_access', {
        p_order_id: 'order-1',
      });
    });
  }

  it('reconciles only current branch listeners when Realtime rejoins, without write replay', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const leaveFirst = subscribePosRealtime({ branchId: 'branch-1', onEvent: first, debounceMs: 100 });
    const leaveSecond = subscribePosRealtime({ branchId: 'branch-1', onEvent: second, debounceMs: 100 });
    expect(mocks.channel.subscribe).toHaveBeenCalledTimes(1);

    mocks.subscription.callback?.('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(150);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    mocks.subscription.callback?.('SUBSCRIBED');
    mocks.subscription.callback?.('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(150);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    leaveFirst();
    mocks.subscription.callback?.('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(150);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    leaveSecond();
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
