# Premier OS — kitchen response to table transfers and separate guest bills

## What changes

When an employee transfers a sent order item or moves a quantity into a separate guest bill, the existing atomic POS transfer RPC reassigns the **existing** kitchen send, inventory event, and served quantity to the receiving order. It does not create a new cooking task or write another inventory deduction.

The KDS now has a small, read-only **recent table/bill changes** banner. It displays only sent-line transfers stored in the existing audit log and shows moved product, sent quantity, source/target table, and destination order number. The banner is scoped to the employee's branch and assigned kitchen station. It is **not** a print dispatch or a new kitchen send.

A kitchen bell rings only for a line whose original server `sent_at` is newer than the previous successful queue read. A moved line may receive a new order number or even a new item/send UUID when partially split, but it retains its old `sent_at` and must not ring again. Genuine new sends to an existing order still ring.

The queue remains read-only: periodic refresh never changes `sent`, `cooking`, `ready`, `served`, refunds, stock, or GL entries. No KDS automatic-completion behavior is added.

## Safety and boundaries

- Authorized users only: read branch via `user_may_access_branch`, KDS capability via `pos.kds_view`, and restrict notices to assigned kitchen stations, matching the existing queue policy.
- No anonymous access to transfer-notice RPC. The response contains display details (product, quantity, tables) but no customer identifiers or raw audit record payloads.
- A transfer made while KDS is offline is visible as a recent historical notice on reconnect. Avoid interpreting the presence of an old banner as a newly cooked item.
- A moved item already marked served is not re-sent to KDS. The existing queue filters served quantities. Completed ticket history is not rewritten.
- Order-level cooking/ready state may not represent all line statuses after a *merge into an already active destination order*; this change does not claim per-line state support. Keep this distinct from avoiding duplicate cooking.
- Data-entry mistakes in customer accounts do not by themselves imply a software defect.

## Tests

`tests/unit/kdsTransferDoesNotRebell.test.ts` covers initial load, same item moved to a new order, partial split with a new line UUID, genuine new sends to an existing order, refresh, and legacy sends. The existing `tests/integration/pos_partial_item_table_transfer.test.ts` verifies original sent timestamps, no new stock events, authorized audit notices, and no anon invocation, using transactionally rolled-back local PostgreSQL fixtures.

Deploy only after clean `verify`, `db` and `browser-smoke`, then confirm the new read RPC and `sent_at` queue field in production via read-only inspection. Never create synthetic kitchen orders in a customer tenant.
