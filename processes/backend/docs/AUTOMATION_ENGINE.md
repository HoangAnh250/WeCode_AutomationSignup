# Playwright automation engine

The Node.js 22.12+ TypeScript/ESM backend now owns real Playwright Chromium processes. Renderer code has not changed. Browser automation is invoked by the existing BullMQ task processor; PostgreSQL remains authoritative for business state, profiles, assignments, accounts and sessions.

## Layout and responsibilities

| Module | Responsibility |
| --- | --- |
| BrowserManager | Fixed-size lazy Chromium pool, FIFO bounded admission, fresh isolated contexts, dedicated persistent contexts, timeouts, cancellation and shutdown |
| ProfileManager / ProfileRepository | Installation-scoped profile metadata, exclusive SQL row-locked acquisition, fenced renew/save/release, safe UUID-only directory resolution |
| ProxyAssignmentService | Healthy enabled proxy assignment, LRU selection, capacity reservations across worker processes, encrypted credential retrieval |
| ProxyRotationService | Different proxy selection between safe retries, no rotation after UNKNOWN/CREATED or for saved/persistent identities |
| StorageStateManager | Validate and AES-256-GCM encrypt cookies, localStorage and IndexedDB snapshots in PostgreSQL |
| SessionManager | Account/profile-bound snapshot creation, retention expiry, active ownership checks, revoked/expired snapshot rejection, restore |
| WorkerExecutor | Acquire resources, execute injected workflow, monitor pause/ownership, fence business commit, persist confirmed results, release or quarantine resources |
| WorkflowRegistry | Explicit target adapter registration; fails closed for unknown keys |
| create-engine / index | Dependency injection composition and public module exports |

Flow: BullMQ -> createTaskProcessor -> WorkerExecutor -> profile lease -> proxy lease -> browser lease -> workflow -> AccountManager -> session snapshot -> browser close -> proxy/profile release -> task completion.

## Install and run

From the repository root, run npm install, npm run db:generate and npm run db:migrate. Run npm run browser:install --workspace @wecode/backend to install the Playwright Chromium version matching the lockfile. Existing Chrome or Edge can be selected using BROWSER_CHANNEL=chrome or msedge instead. Then build using npm run backend:build and launch npm run backend:worker with PostgreSQL/Redis available. API startup remains npm run backend:start.

Browser launch is lazy; a worker process starting successfully does not prove that its browser binary is installed. BROWSER_LAUNCH_FAILED is a retryable pre-commit infrastructure error.

Production startup registers WeverseAdapter under create-account through createProductionEngine. The generic createEngine default remains an empty registry for explicit custom composition and tests. Apply the workflow-state migration before restarting the production worker. See [Weverse implementation](WEVERSE_ADAPTER.md) for HAR mapping, mutation fencing and verification limits. There is no arbitrary uploaded-script execution endpoint or dynamic code loader.

## Adapter contract

BrowserWorkflow receives a Playwright page/context, AbortSignal, fenced ExecutionContext, profile ID, checkpoint and optional restoredAccountId. It returns an account only after observing confirmed business success, plus optional session retention expiry. The engine encrypts the password and records the proxy endpoint without authentication credentials.

The adapter must await execution.assertCanContinue at safe boundaries, save resumable non-secret checkpoints, and honor cancellation. Immediately before the final irreversible remote account creation, await execution.beforeExternalMutation. This atomically changes NOT_CREATED to UNKNOWN. It must never repeat the external creation after UNKNOWN or CREATED. A successful response alone is insufficient unless the adapter can establish the target business result. An API-generated account result without this fence is rejected by the engine's AccountManager lease check.

Do not place credentials, OTPs, cookies or bearer tokens in checkpoints or logs: checkpoints are visible through task history. Use the existing encrypted backend services. OTP expiry, mailbox correlation, consent, selectors, remote idempotency keys and remote authentication validation belong to the trusted target adapter. Pause can restart the page from a checkpoint; arbitrary JavaScript/DOM state is not serialized.

A supplied sessionId requires browser.profileId matching the snapshot. The adapter must implement validateSession and establish remote authentication before execution; cookie presence alone is never authentication proof. Snapshot expiry is retention policy, not a guarantee of the remote session lifetime. BrowserWorkflow.execute remains responsible for the correct behavior when a restored identity is already authenticated.

Each run has one account-creation commit fence. count values above 1 fail with BATCH_REQUIRES_CHILD_TASKS before opening a browser. A batch coordinator must create individual tasks; it is not part of this engine. A resumed run with CREATED and an existing account for that task is finalized without invoking the browser workflow again, even if session snapshot storage previously failed. This does not fabricate a missing session snapshot.

## Pool and profiles

BROWSER_POOL_SIZE limits browser slots per worker process (default 2, maximum 16). Isolated mode uses one fresh BrowserContext per slot and reuses the idle Chromium process. No two jobs share a context. Persistent mode uses launchPersistentContext with a dedicated profile directory and closes it before releasing the slot. Persistent and isolated jobs share the same total slot budget. Pool admission has a FIFO queue capped at 64 waiters and an acquire deadline.

Profile directories are derived from UUIDs under the operator-configured root, never from a renderer path. Default root is the OS local application-data directory / WeCode / automation / INSTALLATION_ID. Set BROWSER_DATA_DIR to override it. The API lists metadata only. Deleting a profile is a soft delete; directories and historical session records are not recursively erased by an API call.

Snapshots in PostgreSQL are encrypted. Persistent Chromium directories contain browser-managed files including local storage; these files are not wrapped in application AES encryption. Protect the OS account, directory ACLs and disk, and retain ENCRYPTION_KEY securely. Node's POSIX mode argument is not a Windows ACL policy. sessionStorage, open pages, live JS state, browser extensions and all forms of device-bound authentication are outside storageState portability. IndexedDB snapshots are included explicitly.

## Ownership, crashes and recovery

Every profile has ownerRunId, ownerToken and leaseExpiresAt. Acquisition locks its SQL row and validates the current running task lease. Heartbeat renews profile/proxy reservations; task heartbeat remains owned by the existing processor. Storage writes are fenced by profile owner and expiry. Account writes also require the same running TaskRun token and UNKNOWN outcome.

Expired resource leases are not stolen automatically. A crashed browser may still hold a persistent directory or proxy session. Unreleased proxy assignments continue consuming capacity even after lease expiry. This sacrifices availability to prevent parallel reuse. Resource cleanup failure quarantines the profile, retains uncertain proxy capacity and stops automatic retries with RESOURCE_QUARANTINED. A poisoned pool slot is not reused until worker restart.

Operator recovery requires stopping/fencing the old worker, confirming its Chromium process is terminated and directory is no longer locked, reconciling any UNKNOWN business result, then releasing the reservation/resetting a quarantined profile through a controlled administrative recovery procedure. An automatic reaper or recovery UI is not included. Never clear a lease merely because its timestamp has elapsed.

INSTALLATION_ID must be unique per desktop installation and remain stable across restarts. Workers using one installation share SQL profile/proxy coordination; they must use the same local profile root when operating on the same host. Do not share a persistent directory over a network filesystem. Pool capacity is per process, not a cluster-wide RAM limit.

## Proxies and retry

Only enabled healthy proxies are eligible. Assignment uses locked candidate rows plus a fresh capacity check and a unique active assignment per run/token. Existing proxy health probes remain responsible for status; assignment does not probe a proxy on every page load. Capacity defaults to 1 per proxy. Health means the configured probe succeeded, not that a target website accepts that IP.

Modes: direct, auto, fixed. A configured proxyId or a bound saved identity is fixed. Missing fixed proxies, incompatible protocols or exhausted capacity fail explicitly; the engine never silently bypasses the requested proxy with a direct connection. HTTP/HTTPS credentials are passed to Playwright without appearing in account proxy_used or logs. Chromium does not support authenticated SOCKS5 directly; those proxies are excluded from automatic selection and explicitly rejected when fixed. A separately operated HTTP bridge is needed for that case and is not supplied here.

BullMQ owns the retry budget (3 attempts, exponential 2-second base backoff in the existing queue). WorkerExecutor does not retry browser actions internally. Browser launch/timeouts and pool/proxy capacity failures may retry only while business outcome remains NOT_CREATED. Auto mode plus rotateOnFailure excludes proxies from earlier failed pre-commit attempts of the same BullMQ run. Fixed proxies remain fixed. Saved state, explicit session restore and persistent profiles cannot silently rotate. Mid-context proxy changes are never attempted.

Once beforeExternalMutation marks UNKNOWN, a timeout, lost response or worker crash requires reconciliation. It is not a reason to create another account. Saving a confirmed account atomically marks CREATED; subsequent snapshot failure preserves that account and prevents duplicate signup. Exactly-once remote side effects are not claimed without target-provided idempotency and reconciliation.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| BROWSER_POOL_SIZE | 2 | Slots per worker process |
| BROWSER_CHANNEL | chromium | chromium, chrome or msedge |
| BROWSER_HEADLESS | true | Visible browser only when false |
| BROWSER_ACQUIRE_TIMEOUT_MS | 30000 | Pool wait deadline |
| BROWSER_LEASE_SECONDS | 120 | Resource heartbeat lease TTL |
| BROWSER_ACTION_TIMEOUT_MS | 15000 | Playwright action timeout |
| BROWSER_NAVIGATION_TIMEOUT_MS | 30000 | Playwright navigation timeout |
| BROWSER_EXECUTION_TIMEOUT_MS | 300000 | Overall workflow cancellation deadline |
| BROWSER_SESSION_TTL_SECONDS | 259200 | Maximum snapshot retention |
| BROWSER_DATA_DIR | OS application-data path | Persistent profile root |

The monitor checks pause/task/resource ownership every 500 ms and renews reservations every TTL/3. Chromium launch itself has a 30-second Playwright timeout. Cooperative cancellation closes the owned context and waits for workflow settlement, with a bounded grace period. API and queue pause semantics remain distinct: queue pause only prevents new delivery, whereas task pause cancels active browser work. Shutdown aborts work before closing the pool. A CPU-blocking or untrusted adapter cannot be safely preempted in the Node.js event loop; adapters must be trusted and asynchronous. The process supervisor remains the final shutdown deadline.

## Verification

Tests use actual headless Chrome, separate PostgreSQL databases and real Redis/BullMQ, against controlled local HTTP fixtures. They never create external website accounts. TEST_ENGINE_DATABASE_URL must end in _engine_test; engine tests clear only that dedicated database. TEST_DATABASE_URL is the separate original backend test database. Both require migrations. Redis uses suite-specific prefixes and no global FLUSHDB.

Run npm run backend:typecheck, npm run backend:build, and npm run backend:test. When using local Chrome, set TEST_BROWSER_CHANNEL=chrome. Run npm run test:engine --workspace @wecode/backend for the engine suite alone. Omitted database URLs cause explicit integration-test skips rather than fake passes. Frontend regression uses npm run typecheck, npm run build and npm test.

Verified scope includes parallel Chromium processes, pool capacity, independent cookies, persistent directories, encrypted PostgreSQL snapshots, cookies/localStorage/IndexedDB restore, SQL profile exclusivity, stale-lease refusal, proxy capacity, safe proxy rotation, real authenticated HTTP proxy routing, session expiry/revocation, pause, shutdown, execution deadlines, single fenced account persistence, unknown-outcome retry rejection, actual BullMQ retries and real browser-backed queue completion. This does not prove external Gmail delivery, a production proxy provider, Weverse selectors/signup, OS crash recovery, remote token refresh or Electron IPC wiring.


EmailVerificationCoordinator is now available on BrowserWorkflowContext.waitForOtp. Pass the generated recipient, known verification sender and a trusted callback that requests the OTP. Tracking is created before dispatch; matching/expiry/cancellation and encrypted code access remain in the backend. The OTP inbox address is never substituted for the generated account identity. See ../../../docs/EMAIL_AUDIT.md.
