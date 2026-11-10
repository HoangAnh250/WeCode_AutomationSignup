# WeCode desktop backend

Node.js/TypeScript ESM, Express 5, PostgreSQL/Prisma 7, Redis/BullMQ and Pino. This workspace adds backend services without replacing the renderer. The Playwright engine is integrated with the existing BullMQ worker.

## Setup

From the repository root:

1. `npm install`
2. Copy `processes/backend/.env.example` to `processes/backend/.env` if no local file exists.
3. Replace API_TOKEN and ENCRYPTION_KEY with independent cryptographically random values. The encryption key is base64 of exactly 32 bytes. Preserve it across restarts; losing it loses access to encrypted data. Do not commit it.
4. Start development dependencies: `docker compose -f processes/backend/compose.yaml up -d --wait`
5. `npm run db:generate`
6. `npm run db:migrate`
7. `npm run backend:build`
8. `npm run backend:start`
9. In another terminal: `npm run backend:worker`

A local .env may already have been generated during implementation; its values are not printed. API defaults to 127.0.0.1:4317, PostgreSQL development port 55432, Redis development port 56379. Compose is development infrastructure with loopback-only ports, not a production database-security configuration. Do not delete volumes when stopping services.

For development, use `npm run backend:dev` and `npm run dev:worker --workspace @wecode/backend`.

## Desktop boundary

Express is an authenticated loopback service for Electron main/services. Browser Origin requests are rejected. The renderer uses the existing preload facade; Electron main/preload now live in apps/desktop and bridge the unchanged renderer to this API. Never place the API token or encryption key into VITE_ variables. In Electron utility-process integration, call `createContainer`/service methods directly or forward through this local API.

All private endpoints require Authorization: Bearer with API_TOKEN. Secrets are write-only except explicit account-password and OTP reveal operations, both audited. Lists do not include ciphertext or plaintext passwords. The API token is an administrative desktop capability, not multi-user role-based auth.

## Modules

- TaskManager: create/update/soft-delete/start/pause/resume/retry with expected version, transactional locks, immutable running configuration, run history and outbox.
- AccountManager: encrypted passwords, searching, filtering, pagination, explicit password reveal.
- ProxyManager: JSON/TXT/CSV parsing, syntax validation, encrypted credentials, real HTTP(S)/SOCKS5 probe, healthy LRU rotation and usage history.
- EmailManager: TLS IMAP connection test, bounded read-only inbox scan, exact recipient/sender/time correlation, six-digit OTP extraction, ambiguity rejection and message reuse protection.
- CatchallManager: CSPRNG usernames/passwords; three username patterns. Does not configure DNS/forwarding or register a real account.
- ExportManager: streaming CSV/XLSX, masked passwords by default, explicit includePasswords=true, CSV formula protection.
- SessionManager: encrypted session payload storage, metadata listing and local revocation. This is not a remote logout or token refresh implementation.

## Automation extension

`src/automation` implements BrowserManager, ProfileManager, ProxyAssignmentService, ProxyRotationService, SessionManager, StorageStateManager and WorkerExecutor. The worker now uses `createEngine`, with PostgreSQL resource leases and encrypted browser snapshots.

Install the matching browser once: `npm run browser:install --workspace @wecode/backend`. Alternatively set BROWSER_CHANNEL=chrome or msedge when that browser is already installed. Browser processes are launched lazily.

A target-specific `BrowserWorkflow` must be registered in WorkflowRegistry and passed to createEngine. The shipped registry is empty: unconfigured tasks become BLOCKED with WORKFLOW_NOT_CONFIGURED. No website selectors, OTP flow or successful account are invented. [Engine guide](docs/AUTOMATION_ENGINE.md) describes the adapter contract, configuration, process lifecycle and verification.

The engine only marks success after a persisted account result confirms CREATED. Pure pre-side-effect transient AppErrors use BullMQ exponential backoff. Unknown side effects move to NEEDS_RECONCILIATION. One task run creates one account; larger batches require separate child tasks and currently fail explicitly rather than partially execute.

## Pause and restart semantics

Queued pause is acknowledged transactionally. Running pause is a desired-state request; the executor reaches a safe checkpoint and acknowledges it. Queue pause stops acquiring new work and does not freeze active execution. Resume creates a new run using the previous checkpoint/outcome. Expired OTP/grants must be reconsidered by the target workflow adapter.

If BullMQ redelivers an execution still marked RUNNING, the processor blocks it rather than risk replaying an external mutation. UNKNOWN runs require reconciliation. The backend does not invent a remote account-existence lookup. Manual reconciliation tooling is not included in this release.

## API contract

`api/openapi.json` is generated from the same Zod request schemas by `npm run docs --workspace @wecode/backend`. See `docs/OPERATIONS.md` for endpoint behavior and `docs/VERIFICATION.md` for tested guarantees. GET /health/live is unauthenticated liveness; /health/ready requires the token and checks DB/queue.

Task commands require the current version. Use Idempotency-Key for task creation; reusing a key for different input returns 409. Account emails are unique. Duplicate results return 409 rather than silently replacing credentials.

## Email assumptions

Only implicit TLS IMAP is enabled. App Password availability depends on provider policy. Create a verification request before requesting an OTP, then scan it. Recipient must match envelope or recognized original-recipient headers, sender must match exactly, and receipt time must be in the request window. No guess is made if multiple codes/messages match. Detection does not assert that the target site verified the OTP. Matching sender headers is not cryptographic sender authentication. Maximum scan: latest 100 matching-date messages, each below 2 MB. Large messages and older candidates are skipped.

## Persistence and exports

Accounts, mailbox app passwords, proxy credentials, OTPs and session payloads are AES-256-GCM encrypted with contextual AAD. Metadata is not encrypted. Use PostgreSQL/TLS and filesystem/OS secret protection in deployment. Key rotation requires a controlled decrypt/re-encrypt migration; changing ENCRYPTION_KEY alone breaks decryption.

Exports use an insertion-time cutoff and UUID cursor, not a long database snapshot: concurrent updates may be observed. Native Save dialogs/file destinations belong to Electron main. HTTP exports stream directly; the backend accepts no arbitrary filesystem path.

## Tests

- `npm run backend:typecheck`
- `npm run backend:test`
- `npm run backend:build`
- `npm audit`

Integration tests require TEST_DATABASE_URL in the backend .env and refuse databases whose name does not end in _test. They clear only that dedicated test database, never the development database. Create `wecode_test` and apply the same migration there before running them. Redis uses a unique per-suite queue prefix, with no global FLUSHDB.

Engine tests additionally require TEST_ENGINE_DATABASE_URL pointing to a separate migrated database ending in _engine_test, plus an installed browser. Set TEST_BROWSER_CHANNEL=chrome to use local Chrome. Missing test database configuration explicitly skips that suite; unit tests still run. Real Gmail delivery and a real external proxy are not tested by fixture-based tests.

## Lifecycle

API and worker have graceful SIGINT/SIGTERM shutdown and a 30-second deadline. No process hides a forced exit as a clean checkpoint. PostgreSQL is the source of business state; Redis only provides delivery. Outbox publishing can duplicate delivery after a crash, so execution status and ownership are rechecked. Exactly-once external account creation is not guaranteed.

## Account email versus OTP inbox

EmailConfig.accountDomain is the domain used for generated signup identities; inboxAddress authenticates the receiving IMAP mailbox only. Advanced mailbox settings include host, port and folder; TLS remains mandatory. Catch-all forwarding is configured with the domain provider, not by IMAP login. Original-recipient headers are matched against the generated account email. See ../../docs/EMAIL_AUDIT.md for the additive migration and worker waitForOtp integration.
