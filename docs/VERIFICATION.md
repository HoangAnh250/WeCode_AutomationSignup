# Frontend verification

- TypeScript strict check and Vite production build passed.
- 17 Playwright renderer tests passed using local Google Chrome in headless mode.
- Covered all eight pages, task lifecycle, proxy TXT/JSON import, deduplication, invalid lines, filtered CSV export, mailbox password clearing, profile restrictions, log filtering/export, settings validation, keyboard palette, missing IPC, and a supplied preload facade.
- Layout checked at 1440, 1024, 800 and 600 pixels without document horizontal overflow.
- Dashboard screenshot inspected after loading; see screenshots/dashboard-desktop.png.
- npm dependency audit at installation reported zero vulnerabilities.

This frontend suite exercises renderer preview/preload behavior; preview actions are frontend-only simulations. Production without preload shows an unavailable-service state. The backend and Playwright engine now have separate PostgreSQL/Redis/browser integration coverage; see [backend verification](../processes/backend/docs/VERIFICATION.md). Electron main/native IPC and real mailbox delivery remain outside these checks.

Electron shell integration and native IPC/file writing now have separate verification; see [desktop integration](DESKTOP.md). React source and components were preserved during that integration.

## Repository import verification (2026-11-10)

The current source tree was checked before the initial GitHub import:

- Renderer, Electron and backend TypeScript checks passed.
- React/Vite production build, bundled Electron main/preload build and backend TypeScript build passed.
- All 17 renderer Playwright tests passed.
- All 9 Electron contract/security unit tests passed.
- Backend: 31 unit tests passed. The integration run could not complete: 22 engine tests failed because PostgreSQL at 127.0.0.1:55432 was unavailable; the 16 API integration tests were skipped after their setup timed out waiting for Redis. Docker Desktop's Linux engine pipe was unavailable during this run. This is not a successful full backend integration verification. Earlier verification documents describe their own earlier runs.
- The publication candidate tree was checked against actual local API/encryption secret values and common credential/private-key patterns. Local configuration, runtime data, captured HARs, dependencies and release binaries are ignored.

This check does not establish real Weverse signup or live Gmail forwarding. The target-specific signup adapter remains unimplemented.

## Saved App Password update (0.1.4)

TypeScript checks and React/Electron/backend builds passed. All 17 renderer tests, 33 backend unit tests and 9 desktop unit tests passed. Real Electron production-mode and packaged Windows EXE smoke runs against an authenticated local backend fixture verified saved-password loading, masked defaults, Show/Hide and recovery after closing/relaunching the app with the same desktop settings. Existing account export, IPC validation, task diagnostics and retry smoke checks also passed. These checks use fixtures, not a live Gmail inbox. PostgreSQL/Redis integration was not rerun because Docker Desktop was unavailable.

## WeverseAdapter implementation

Prisma client generation/schema validation and backend build passed. The backend independent suite now has 43 passing tests, including 10 adapter cases with real Chromium and local HAR-shaped HTTP/mail/database-port fixtures. Coverage includes production registration, WorkerExecutor/AccountManager persistence, encrypted draft reload/lease rejection, safe retry identity retention with fresh OTP, required-only consent, duplicate POST suppression, authenticated proxy forwarding, lost-response UNKNOWN outcome and confirmed-journal recovery. The 9 desktop tests and frontend/Electron TypeScript checks also passed. Docker was unavailable, so the new migration has not been applied or tested against local PostgreSQL in this session. A live navigation-only check verified the signup entry and initial field labels without submitting identity/OTP/account data. Live signup and Gmail delivery remain unverified.

## OTP/batch/browser update (0.1.5)

All 88 backend tests passed, including PostgreSQL/Redis integration and real Chromium fixture cases. All 18 UI tests passed; the batch/layout checks were repeated after the final checkbox styling and passed. All 9 desktop tests and TypeScript/build checks passed. A live navigation-only check confirmed Block Overseas Logins changed from true to false. Re-reading the original ambiguous verification email with the corrected parser produced one matching message with one OTP candidate; no code value was output. The test did not submit a new signup.

The real backend/worker and Electron app were restarted after confirming zero active jobs. Optional Show browser is enabled on new tasks; the operator's local default was also switched to visible so existing tasks without an explicit headless setting can be observed. The queue's original pause state was restored after restart.

## Agree to All correction (0.1.6)

All 89 backend tests and 9 desktop tests passed. The browser fixture now hides child consent terms in collapsed groups and enables final submit only through Agree to All, reproducing the reported screen. The adapter selects the aggregate checkbox and requires agreed=true for all current documents before its mutation fence; a missing agreement is rejected. Block Overseas Logins remains independently enforced as false. The backend/worker and desktop were restarted only after queue active count was zero. No real signup was submitted by this update.

## Visible application version (0.1.7)

Renderer/Electron TypeScript checks and production build passed. Real Electron and packaged Windows EXE checks verified that the title, frozen preload appVersion, sidebar/footer and Settings match app.getVersion() (0.1.7). Settings also displays the UI build time. Test user-data directories were isolated; no account task or mailbox operation was started. The operator's desktop window was reopened on the current build without restarting backend services.
