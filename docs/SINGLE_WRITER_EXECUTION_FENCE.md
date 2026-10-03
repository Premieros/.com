# SINGLE-WRITER EXECUTION FENCE — Premieros/.com

Repository: `Premieros/.com`
Mode: **SINGLE WRITER / SEQUENTIAL WRITES**

## Rules

1. Read operations may be parallel; repository writes must be sequential.
2. Before every write, fetch the current target-branch HEAD and require it to match the expected parent.
3. An unexpected HEAD must be reviewed before continuing.
4. Never accept unknown commits automatically.
5. After interruption or tool failure, re-read branch HEAD and resume from repository state.
6. Keep logical changes small and independently reviewable.
7. Production database mutations remain separately gated by explicit user approval.

Repository history and the canonical identity lock are the source of truth for execution state.
