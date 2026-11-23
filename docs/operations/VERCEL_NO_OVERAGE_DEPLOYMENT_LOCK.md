# PremierOS — Vercel Cost & Deployment Lock

**Owner mandate (2026-11-23):** The existing Vercel Pro subscription ($20/month) is the authorized plan. No agent, model, automation, developer tool, or integration is authorized to incur extra Vercel spend or change Vercel billing/deployment settings without the human account owner's explicit, fresh approval.

## Current production
- Team: `premieros-3817` (Vercel Pro)
- Project: `premier.os`
- Sites: `bunker-egy.app`, `www.bunker-egy.app`
- Keep the *current* production deployment serving.
- On 2026-11-23, the project was configured with `previewDeploymentsDisabled=true` and `commandForIgnoringBuildStep=node -e "process.exit(0)"`. This tells Vercel to skip new Git-triggered builds. **Do not remove these controls.**

## Explicitly forbidden by default
1. New Vercel deployments, builds, promotions, redeploys, previews, AI Gateway/Marketplace billable products, paid observability, storage, edge functions, sandboxes or provisioned resources.
2. Increasing usage budgets, disabling spend warnings, turning on automatic overage charging, or upgrading the team's plan/seats.
3. Editing/clearing the project's Ignore Build Step, enabling preview deployments, or changing deployment policies to circumvent the lock.
4. Connecting another Vercel team/project as a workaround.

## Allowed
- GitHub branches, code edits, pull requests, CI tests that **do not deploy to Vercel**, read-only cost audits.
- Improving the static Vite app and Supabase back end without creating Vercel billable resources.

## Release procedure (human owner only)
1. The human owner reviews current Vercel usage, billed spend, available credits, and any risk of overage.
2. The human owner explicitly authorizes *that specific* deployment in a fresh interaction.
3. If and only if approved, an administrator temporarily unlocks the minimum required deployment settings, verifies the release, and immediately restores the lock.
4. Confirm after each deployment that current production remains healthy and that spend remains within the owner's requirement.

## Security limitation
Repository policies and ignore-build settings are **not** an immutable billing hard cap. A Vercel account admin/token with write permissions can still change them or trigger other chargeable actions. To make this enforceable against AI models, remove billing/deployment-write access from their connectors/API tokens, restrict GitHub environment secrets and workflows via human-controlled branch rules, and configure Vercel spending controls at the account level. The hard cap must be verified in Vercel billing; a warning-only budget is insufficient. No agent must assert a guarantee that the final bill cannot exceed $20 until Vercel enforces such a limit.
