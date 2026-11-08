import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const connection = process.env.SUPABASE_DB_URL;
const local = connection && ['localhost', '127.0.0.1', '[::1]']
  .includes(new URL(connection).hostname);

describe.skipIf(!local)('unsent quantity rejection predicate (isolated PostgreSQL, reads only)', () => {
  const db = new Client({ connectionString: connection });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  // Table-shaped VALUES are synthetic; never read or write restaurant records.
  const check = async (data: Array<{ orderId: string; itemId: string; quantity: number; sent?: number; sendOrderId?: string }>, chosenOrderId: string) => {
    const orderIds = data.map(row => row.orderId);
    const itemIds = data.map(row => row.itemId);
    const quantities = data.map(row => row.quantity);
    const sends = data.filter(row => row.sent !== undefined);
    const result = await db.query<{ blocked: boolean }>(`
      WITH order_items AS (
        SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::numeric[])
          AS t(order_id, id, quantity)
      ), order_kitchen_sends AS (
        SELECT * FROM unnest($4::uuid[], $5::uuid[], $6::numeric[])
          AS s(order_id, order_item_id, sent_quantity)
      )
      SELECT EXISTS (
        SELECT 1 FROM order_items oi
        LEFT JOIN order_kitchen_sends s
          ON s.order_item_id = oi.id AND s.order_id = oi.order_id
        WHERE oi.order_id = $7::uuid
          AND oi.quantity > COALESCE(s.sent_quantity, 0) + 0.000001
      ) AS blocked
    `, [orderIds,itemIds,quantities,
      sends.map(row => row.sendOrderId || row.orderId),
      sends.map(row => row.itemId),
      sends.map(row => row.sent),
      chosenOrderId]);
    return result.rows[0].blocked;
  };

  it('rejects missing and partially sent lines; accepts fully dispatched lines', async () => {
    const orderId=randomUUID(),itemId=randomUUID();
    expect(await check([{orderId,itemId,quantity:2}],orderId)).toBe(true);
    expect(await check([{orderId,itemId,quantity:2,sent:1}],orderId)).toBe(true);
    expect(await check([{orderId,itemId,quantity:2,sent:2}],orderId)).toBe(false);
  });

  it('does not mistake another order send for the current order', async () => {
    const orderId=randomUUID(),otherOrder=randomUUID(),itemId=randomUUID();
    expect(await check([{orderId,itemId,quantity:2,sent:2,sendOrderId:otherOrder}],orderId)).toBe(true);
    expect(await check([
      {orderId,itemId,quantity:2,sent:2},
      {orderId:otherOrder,itemId:randomUUID(),quantity:3},
    ],orderId)).toBe(false);
  });

  it('accepts zero-quantity rows and rejects any unsent line in a mixed order', async () => {
    const orderId=randomUUID();
    expect(await check([{orderId,itemId:randomUUID(),quantity:0}],orderId)).toBe(false);
    expect(await check([
      {orderId,itemId:randomUUID(),quantity:1,sent:1},
      {orderId,itemId:randomUUID(),quantity:1},
    ],orderId)).toBe(true);
  });
});
