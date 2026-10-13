# Offline POS sale movement identity and branch-scoped cleanup — 2026-10-13

## Finding and risk

Prior to this PR, new offline stock deductions used only the displayed invoice number as their local movement reference. Different branch terminals or repeated invoice numbers could share that reference. The confirmation paths called `markMovementsSynced([invoiceNumber, saleId])`, which deleted **every matching local movement regardless of branch**. This risks removing another terminal's still-pending stock deduction. Meanwhile, the queued-stock fallback could apply the same legacy invoice movement to two distinct unsynced sale rows, hiding the second sale's stock deduction.

## Implementation

- New local movement rows produced by `payment.ts` and `SalesRepository.enqueueSale` use the immutable **client-side queued sale ID** as `referenceId`; the displayed invoice remains unchanged for the server and receipt.
- `saleMovementIdsForCleanup` selects local movements by sale ID and **matching branch**, preserving unrelated adjustments and synced rows. Legacy invoice-only movements are cleaned only if no second unsynced sale in that branch shares the invoice.
- `getUnrecordedQueuedSaleDeductions` consumes recorded quantities **at most once**, prioritizes unique sale ID movements and permits invoice fallback for historical rows. A second queued sale cannot borrow the first one's stock deductions.
- `markSaleMovementsSynced(saleId, invoice, branch)` replaces broad cleanup at the sync engine, manual discard and sales repository; it requires both ID and branch. It uses `dbGetAllStrict` to reject IndexedDB read errors rather than silently assuming the store is empty, and awaits movement deletion **before** deleting the confirmed sale from the outbox.
- Unit tests verify duplicate invoice isolation, branch scoping, aborted local cleanup, outbox preservation and missing-branch refusal.

## Boundaries

- Does not edit any production Supabase data, functions, schemas, FIFO costs, journals or historic stock.
- Previous ownerless offline queues remain held for human attribution; old ambiguous invoice-only movements are conservatively preserved until the competing pending sales are resolved.
- Does not change online POS sale accounting or server idempotency key behavior.
- Separate work is still needed for **warehouse-scoped** availability: a branch-level stock total must not be represented as verified warehouse quantity. These cleanup guards protect branches and sale identities, not per-warehouse availability.

## Acceptance

Typecheck, lint, unit tests (including simulated crash cleanup), disposable DB suite and Playwright smoke must pass on the exact PR head. No production database rollout is required.
