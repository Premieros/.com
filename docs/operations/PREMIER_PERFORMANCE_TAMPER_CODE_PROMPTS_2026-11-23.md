# PremierOS — performance hangs, tampering, and optional code prompts

Date: 2026-11-23. Scope: development branch only, no production deployment, no production DB writes.

## Verified and fixed in branch

- `PageProgressLoader` used an *artificial* progress bar which saturates at 92% and previously had no stall message or operator-controlled recovery. It now offers a clearly labelled manual page reload after 15 seconds. The watchdog is cancelled when page loading completes, and **never** automatically resubmits checkout, orders or payments.
- The timeout is a recovery UX fix, **not a network-layer fix** and **not proof** that the application cannot hang elsewhere.
- Source contract tests cover the watchdog and cleanup.

## Areas requiring anti-tampering review

- `CashierDiscountApprovalCard` reacts to an `approval_requests` Realtime status change and invokes an `onApproved` callback. Verify that the *final pricing and checkout mutation RPCs* re-check approver permissions, approval scope, and monetary limits on the server. A client callback is not authoritative proof.
- `SettingsContext` caches global and branch settings under browser-wide keys. Audit cross-user cache isolation; never let cached settings grant security permissions or decide approval policy. UI cache is not a trusted authorization source.
- `get_my_kitchen_stations` currently returns all active non-cashier stations to an authorized branch user who has no explicit station assignments. Treat this as a separate KDS permission concern and do not silently change access before a tested rollout.
- SQL/RPC must independently enforce branch, role, idempotency, amount, and transaction integrity regardless of what a React form displays.

## User requirement: do not request an additional code unless enabled in Settings

Treat optional **extra verification or approval codes** as **OFF by default**. Display such a prompt only when the appropriate explicitly enabled server-backed option applies to that actor, branch and action. The server must enforce the very same setting at the final mutation. UI-only toggles are bypassable.

**No blanket disabling of actual sign-in credentials or session recovery security is authorized:** `LoginPage` separately supports employee PIN *as a login method*, and the public QR visitor recovery PIN protects transfer of a visit to a different device. These are distinct from optional extra confirmation codes. The exact code workflow the owner intends to make optional must be confirmed before changing authentication or recovery RPCs.

A protected config migration, explicit Settings UI toggle, and both on/off access-control tests are required before implementing this workflow. Do not force a verification prompt when a confirmed optional configuration is disabled, or silently bypass a server-required secret when enabled.

## Release constraints

No Vercel deployment, preview, spend-setting change, or promotion without fresh specific human approval. Existing production remains unchanged. CI green is not equivalent to browser E2E verification.
