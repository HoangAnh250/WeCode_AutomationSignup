# Development history and import provenance

This repository was initialized from an existing working project. No local Git history or earlier source snapshots were available, and the target GitHub repository was empty.

The initial commits group the current implementation into logical module-import milestones. They do not reconstruct exact former application versions or original development dates. Every commit uses its actual import date. Files retain their current implementation; early imports contain contracts and imports whose modules arrive in later commits. Intermediate import commits are not independently runnable release snapshots. The final import commit is the complete, supported source tree.

## Import milestones

1. Workspace configuration and React/Vite desktop workbench.
2. PostgreSQL/Prisma schema, migrations, repositories and domain services.
3. Express API, task lifecycle and Redis/BullMQ queue delivery.
4. Playwright browser pool, isolated profiles, proxies and session persistence.
5. Electron shell, secure IPC, native exports and Windows packaging.
6. Account-domain / OTP-inbox separation and forwarded-recipient verification.
7. Encrypted desktop connection persistence and local service launcher.
8. Task diagnostics, readable logs, safe Retry state and regression coverage.
9. Current operating guides, verification records and complete source-tree map.

## Current application boundary

The desktop and automation infrastructure exist. A target-specific Weverse signup workflow adapter has not been implemented or registered. Actual signup tasks stop with WORKFLOW_NOT_CONFIGURED before browser actions. This history does not claim working end-to-end Weverse registration.

## Publication exclusions

Local .env files, actual API/encryption keys, exported account credentials, captured HAR traffic, runtime logs, browser state, dependencies, test output and release binaries are excluded. Credentials appearing in examples, test fixtures or the local development compose configuration are intentional development fixtures.
