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
