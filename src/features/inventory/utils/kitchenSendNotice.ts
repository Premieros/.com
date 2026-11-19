import type { KitchenQueueItem } from '@/lib/types';

export type KitchenTransferNotice = {
  event_id: string;
  created_at: string;
  product_name: string;
  quantity: number;
  station: string;
  split_bill: boolean;
  source_table: string;
  target_table: string;
  target_order_number: string;
};

/** One sent kitchen line may move between orders or be partially split,
 * but its original sent_at stays unchanged. New sends to an existing order
 * must still ring. Legacy rows without send time do not trigger false bells. */
export function kitchenSentLineKeys(items: KitchenQueueItem[]): Set<string> {
  return new Set(items.flatMap(ticket => ticket.items
    .filter(line => line.order_item_id && line.sent_at)
    .map(line => `${ticket.station}:${line.order_item_id}:${line.sent_at}`)));
}

export function hasGenuinelyNewKitchenSend(
  previous: ReadonlySet<string> | null,
  current: KitchenQueueItem[],
  previousReadAt: number | null,
): boolean {
  if (!previous || previousReadAt == null) return false;
  return current.some(ticket => ticket.items.some(line => {
    if (!line.order_item_id || !line.sent_at) return false;
    const sent = Date.parse(line.sent_at);
    // A partial move can clone a send row with a fresh ID but retains its
    // earlier sent_at. It must not ring as a newly prepared kitchen order.
    return Number.isFinite(sent) && sent > previousReadAt
      && !previous.has(`${ticket.station}:${line.order_item_id}:${line.sent_at}`);
  }));
}
