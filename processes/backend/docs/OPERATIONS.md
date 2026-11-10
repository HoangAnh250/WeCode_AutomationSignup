# Backend operational contract

## Task states

DRAFT -> QUEUED -> RUNNING -> SUCCEEDED.

Additional states: PAUSE_REQUESTED, PAUSED, FAILED, BLOCKED, NEEDS_RECONCILIATION.

A task run separately records NOT_CREATED, CREATED or UNKNOWN. A FAILED execution with CREATED outcome is not permission to create another account. Version conflicts are 409. Changing a paused task execution configuration resets it to DRAFT and invalidates checkpoint selection; changing its name alone preserves the paused state. Editing is limited to DRAFT/PAUSED/FAILED/BLOCKED with no created/uncertain result. Deletion is soft and unavailable while queued/running/pause-requested/uncertain.

## Routes

- /api/v1/tasks: GET, POST. /{id}: GET, PATCH, DELETE. /{id}/start|pause|resume|retry: POST.
- /api/v1/task-runs/{id}: GET execution detail.
- /api/v1/accounts: GET, POST. /{id}: GET. /{id}/password: GET with audit and no-store.
- /api/v1/exports/accounts: GET; format csv/xlsx, optional includePasswords=true and the same search/status/taskRunId filters as accounts.
- /api/v1/proxies: GET. /import: POST; format json/txt/csv, content, dryRun. /rotate: POST. /statistics: GET. /{id}/check: POST. /{id}/health: GET. /{id}: PATCH enabled flag.
- /api/v1/email-configs: GET, POST. /{id}: PATCH. /{id}/test: POST. /{id}/verifications: POST.
- /api/v1/verifications/{id}: GET. /scan: POST. /code: GET explicit sensitive access.
- /api/v1/catchall/identities: POST; domain, pattern, randomLength, digits, password policy, count.
- /api/v1/sessions: GET by accountId, POST encrypted payload. /{id}/revoke: POST.
- /api/v1/queue: GET counts. /pause and /resume: POST. Retry is always through TaskManager, never raw job.retry.
- /api/v1/logs: GET paginated audit events, optional category/search.

## Limits

HTTP JSON 3 MB; proxy content 2 MB / 5000 entries; page size max 100; IMAP scan max 100 messages under 2 MB; identity generation max 100 per call; password 12-128 characters. The desktop API is limited to 300 private requests/minute/client IP. Configuration controls worker concurrency 1-16. Proxy probe timeout 8 seconds. HTTP API never logs request bodies, headers or full URLs containing query data.

## Proxy formats

TXT: host:port or host:port:user:pass; bracketed IPv6 supported. URI: http://, https://, socks5:// with percent-encoded auth. CSV: host,port,protocol,username,password. JSON: array of strings or objects. Partial credentials are rejected. Import errors never echo the original secret-containing row. Duplicate endpoints/auth identity are skipped; importing is not a credential-update operation.

Health probes target the operator-configured PROXY_PROBE_URL. A healthy result proves access to that probe only, not a target site's acceptance. Rotation selects enabled healthy proxies in least-recently-used order and records selection counts; it does not itself enforce browser capacity or change an active browser's proxy.

## Extension boundaries

The Playwright engine is installed and integrated into the worker, including SQL profile/proxy leases. A target-specific workflow adapter, Electron IPC facade adapters, native dialogs, GUI changes, batch scheduling and automated reconciliation remain separate work. See AUTOMATION_ENGINE.md. PostgreSQL and Redis services must be available. Deployment requires a stable encryption key, unique service token, database backup and protected service endpoints.


## Browser profiles

- GET /api/v1/browser-profiles: metadata for this INSTALLATION_ID, newest first, limit 500.
- POST /api/v1/browser-profiles: name, mode (isolated/persistent), optional proxyId.
- DELETE /api/v1/browser-profiles/{id}: soft-delete only an idle local profile. Disk data is retained for explicit operator-managed retention.
- PATCH /api/v1/browser-profiles/{id}/proxy: proxyId (UUID or null), idle only. Saved identities cannot silently switch proxies.

Task config adds optional browser.profileId, profileMode, proxyMode (direct/auto/fixed), rotateOnFailure and sessionId. Top-level proxyId selects a fixed proxy; a saved/profile-bound proxy also takes precedence. This preserves older configs. Engine runs require count=1. Proxy imports still start as unknown; run a health check before browser assignment.
