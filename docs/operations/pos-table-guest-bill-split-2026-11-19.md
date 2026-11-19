# POS restaurant tables: transfer, merge and individual guest bills

## Existing behaviors retained
- Select several saved POS order lines, including repeated product IDs with different modifiers, and move precise quantities to another table via the existing atomic `transfer_order_items_to_table` RPC.
- Whole-order transfer to a vacant table and approved merge of unsent orders use existing `perform_pos_order_action` RPC. Existing sent-kitchen merge guard remains enforced; use quantity transfer for kitchen-sent items instead of overwriting historical kitchen sends.
- All changes remain within one branch, validate `pos.order.transfer`, use authoritative saved line snapshots, have an idempotent operation UUID and preserve FIFO/warehouse/kitchen event history without double deduction.

## New: same physical table, multiple bills

In the POS Current Order panel, select one or more saved lines (even two lines of **the same product**) and open **Move items / Separate bill**. Enter a quantity per selected line, then choose the **current table**. This creates a new sibling open order on the same table—never appends to another guest's bill. Its own order number is used as its bill number. The action is atomic; retry with the same operation ID resolves to the same target bill. Full or partial line movement moves KDS line ownership/cost snapshots without sending another kitchen item or consuming more stock.

The existing table modal now displays **each open bill separately**. Opening and settling each order is separate; the physical table remains occupied as long as any active bill remains.

## Operational safeguards
- Do not split saved orders after partial payment or settled kitchen inventory: the existing backend guard rejects them until reconciliation; never silently move paid quantities.
- Open order line snapshots are the source of truth; unsaved cart edits must be saved before transfer.
- Do not copy an already-issued sale receipt or journal into a new bill. A bill is a distinct open order until settled through the existing sale RPC.
- The existing authorized unsent-order merge remains. A full **sent** order merge through the old manager-action RPC is intentionally blocked; the quantity-transfer path supports kitchen-sent lines while preserving audit and KDS histories.
- Customer-entered bad data is not a software quality failure unless an actual integrity/security violation is proven.

## Verification
New DB regression in `tests/integration/pos_partial_item_table_transfer.test.ts` checks two same-product lines, partial and whole quantities, identical table ID for distinct orders, financial conservation, kitchen event count, stock invariance, replay, same-operation collision and wrong-target denial. It runs only on a disposable CI PostgreSQL database and rolls back every fixture.
