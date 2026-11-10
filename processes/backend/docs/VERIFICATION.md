# Backend verification

## Passed

- Strict TypeScript typecheck and compiled backend build.
- 57 automated tests across five test files; no skipped integration tests in the verified run.
- Dedicated PostgreSQL test database and actual Redis/BullMQ queue used for integration tests.
- Initial and additive browser-engine Prisma migrations deployed successfully to development and both dedicated test databases.
- Compiled server startup smoke test passed: ready checks, unauthorized rejection and authenticated HTTP listing.
- Concurrent task starts: one accepted, one rejected; one run/outbox record.
- Idempotency-key replay and mismatched-payload rejection.
- Queued pause/resume and cooperative running-task pause with checkpoint preservation.
- Editing execution configuration invalidates old paused checkpoint selection.
- Default absent automation adapter produces BLOCKED, never a fake account success.
- Transient pre-side-effect retry succeeds only after a stored account result.
- Unknown external mutation outcome blocks retry.
- Encrypted account/session storage, explicit password reveal, no ciphertext in lists.
- Real CSV and ZIP-based XLSX exports read back by ExcelJS, filtered output, masked default secrets, CSV formula neutralization.
- Proxy import variants, CSV, validation, duplicate handling, rotation/usage and saved health history.
- Actual local HTTP proxy protocol tests, including authentication and 407 rejection.
- IMAP service correlation tested with injected mailbox fixtures: exact sender/recipient/time, ambiguity and code expiry behavior.
- HTTP authentication, browser-Origin rejection and input-error secret suppression.
- npm audit: zero reported vulnerabilities after dependency updates and uuid override.
- Existing frontend typecheck/build and all 14 Playwright UI regression tests pass.
- Two concurrent Chromium instances, isolated contexts and bounded pool admission.
- Persistent profile reopen and PostgreSQL-encrypted cookies/localStorage/IndexedDB restore.
- Exclusive SQL profile ownership, stale lease refusal, proxy capacity and safe retry rotation.
- Actual Chromium routing through a local authenticated HTTP proxy.
- Snapshot restore, expiry/revocation checks, active pause, shutdown and execution deadline cancellation.
- Real browser-backed BullMQ job completion and a real queue retry before business commit.
- Account fence rejection, UNKNOWN outcome reconciliation, CREATED resume without duplicate submission.
- Injected uncertain cleanup quarantines profile and disables automatic retries.
- Profile HTTP metadata CRUD without browser snapshots or owner tokens.

## Not claimed

- Playwright engine is implemented and verified with real local headless Chrome; a target-specific website signup adapter is not included.
- No live website account was created.
- No real Gmail/App Password, provider delivery or external residential proxy was exercised.
- Electron main/preload and its API adapter are verified separately in docs/DESKTOP.md at the repository root.
- Local session revocation does not revoke a remote website token.
- Legacy proxy selection statistics count selections. Engine proxy_assignments separately enforce SQL capacity leases; no automatic lease reaper is supplied.
- Exactly-once external account creation and automatic reconciliation are not implemented.

## Tooling limitation

Postman CLI 1.74.0 is present, but request/collection commands fail because a managed Private Cloud manifest cannot be read; `postman status` is not supported by that CLI. No registry policy was modified. API behavior was verified with Supertest over actual HTTP and real PostgreSQL/Redis instead. OpenAPI remains a local generated artifact; nothing was published externally.
