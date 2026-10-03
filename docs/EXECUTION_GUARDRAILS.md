# Execution Guardrails — Premieros/.com

Repository: `Premieros/.com`
Canonical Supabase: `hvqlkapynjfjikqithvd`
Production branch: `main`

## Hard safety rules

- Preserve existing business data and production semantics unless correcting a proven defect.
- Never use Production as a disposable test environment.
- Database schema changes require explicit user approval before execution.
- No force push.
- No RLS weakening.
- No cross-organization, cross-branch or cross-warehouse fallback.
- Financial and inventory mutations must preserve idempotency and auditability.
- Local/CI PostgreSQL may be used for isolated tests; hosted runtime identity remains locked to the canonical Supabase project.

## Verification gate

Before a completed change is accepted:
- repository/database identity checks pass;
- lint and typecheck pass;
- relevant unit/integration tests pass;
- build passes;
- offline/sync tests are included when the change affects local-first behavior;
- no foreign repository or hosted database reference remains.

## Product principle

Simple inside, complete outside, correct data first.
