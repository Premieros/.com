# PremierOS — mandatory instructions for all coding agents

## HARD STOP: Vercel spending and deployments (human-owner authorization required)

The human owner has paid for Vercel Pro ($20/month) and **forbids any additional Vercel charges**. No AI agent, coding model, automated workflow, or teammate acting on an agent's advice may initiate any Vercel deploy, preview, redeploy, CLI deploy, promotion, resource provisioning, AI Gateway usage, billable integration, upgrade, seat increase, or spending-control change without fresh, explicit approval from the human owner for that exact action.

**DO NOT** remove or change these active Vercel project controls:
- `premier.os`: `previewDeploymentsDisabled=true`
- `commandForIgnoringBuildStep=node -e "process.exit(0)"` (skip new Git-triggered builds)
- Existing BUNKER production sites must stay available.

GitHub code edits, branches, non-deploying CI, read-only Vercel billing checks, and Supabase development that does not provision Vercel resources are allowed.

Before any deployment request: STOP, present the planned Vercel action, verify available funds/credits and worst-case charge risk, request the human owner's specific approval, and only then proceed within authorized scope. Afterwards restore deployment lock.

Read `docs/operations/VERCEL_NO_OVERAGE_DEPLOYMENT_LOCK.md` for the full policy.

**Caveat:** This file is policy, not access control. Administrators and tokens with Vercel write permissions can bypass repository text and some dashboard settings. Truly enforce no agent bypass by revoking agent/tool Vercel write scopes and managing billing controls with a human-owned Vercel admin account. Never claim an absolute $20 bill guarantee solely from this file.
