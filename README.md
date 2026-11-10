# WeCode Desktop

Electron desktop shell around the existing React/Vite renderer. Existing React pages/components remain in place; targeted Account Domain and OTP Inbox corrections are documented in docs/EMAIL_AUDIT.md. Electron main/preload implement the existing window.wecode protocol and delegate business operations to the existing authenticated loopback backend.

## Commands

Use Node.js 22.12+ on Windows x64. From this repository root:

| Command | Result |
| --- | --- |
| npm install | Install workspace and desktop build dependencies |
| npm run dev | Compile main/preload, start Vite, then open an Electron desktop window |
| npm run build | Build React production assets and bundled Electron main/preload |
| npm run start | Open the locally compiled desktop application |
| npm run dist | Build and create Windows NSIS installer plus portable EXE |
| npm run dist:dir | Build an unpacked Windows application |
| npm run dev:web | Run the original browser-only renderer preview |
| npm run typecheck | Typecheck renderer and Electron code |
| npm test | Renderer Playwright regression tests |
| npm run test:desktop | Desktop contracts, security boundaries, persistence and adapter tests |
| npm run test:electron | Build and run real Electron production-mode smoke/integration checks |

Stop any earlier browser preview using port 5173 before npm run dev. Closing the Electron dev window or pressing Ctrl+C stops the launcher-owned Vite process. React keeps Vite HMR; restart npm run dev after main/preload edits.

## Windows artifacts

npm run dist writes:

- release/WeCode-0.1.3-Setup-x64.exe
- release/WeCode-0.1.3-Portable-x64.exe
- release/win-unpacked/WeCode.exe

The NSIS wizard installs per-user, supports installation-directory selection and creates Start menu/desktop shortcuts. Portable runs without installation. The current artifacts are unsigned because no Authenticode certificate is configured. Versions in artifact names follow package.json.

## Backend connection

The desktop client does not replace or embed PostgreSQL, Redis, the API or automation worker. Start the existing backend with npm run backend:start and npm run backend:worker after its dependencies are ready. See [backend setup](processes/backend/README.md) and [automation engine](processes/backend/docs/AUTOMATION_ENGINE.md).

During repository development, Electron main can read the existing backend .env to obtain API_TOKEN. In packaged builds, set WECODE_API_TOKEN to the same token as the local backend. WECODE_BACKEND_URL optionally overrides http://127.0.0.1:4317/; only loopback HTTP origins are accepted. Do not use VITE_ environment variables for secrets. Neither .env files nor backend secrets are bundled into the installers.

Without a configured/reachable backend, the desktop window still opens with empty tables and a connection diagnostic in Logs. It does not create simulated accounts or acknowledge business operations as successful. Settings persist in the OS application-data directory. Database-dependent actions report a connection error until the existing services are available. The target-specific account-creation workflow adapter remains a separate automation-engine integration point.

The existing account Export button sends includePasswords=true through preload, with no checkbox. Main delegates to the backend's guarded export API, filters the selected account IDs and uses native Save As. List responses and renderer workspace state do not contain passwords. Session tokens are not exported.

See [desktop architecture, configuration and verification](docs/DESKTOP.md), [frontend verification](docs/VERIFICATION.md) and [backend verification](processes/backend/docs/VERIFICATION.md).

Email configuration audit and migration: [EMAIL_AUDIT.md](docs/EMAIL_AUDIT.md). Use release 0.1.1 for the updated desktop email UI.

## Local desktop launcher

Double-click Start WeCode.cmd (or run npm run desktop:local) from this checkout. It uses the existing backend .env privately, starts the local API/worker when needed, and opens the current portable build with the matching administrative token. Docker Desktop must be available; PostgreSQL/Redis containers are started by the launcher. Compiled backend files and npm dependencies must already exist.

Electron 0.1.2 stores the backend connection in backend-connection.json under its OS application-data directory, encrypting the token with Electron safeStorage (Windows DPAPI). Subsequent launches do not require WECODE_API_TOKEN. No token is embedded in the EXE, renderer, desktop-settings.json or repository. The launcher is useful after a reboot to bring up the independent local services.

New tasks default to Local (no proxy). This uses the computer's current network connection and does not reserve a managed proxy, even when the proxy pool is populated. Auto assign and fixed proxies remain separate choices. Local tasks must not use a proxy-bound browser profile; select Auto assign for the profile or create a separate unbound profile.

Task Retry and readable execution logs: [TASK_DIAGNOSTICS.md](docs/TASK_DIAGNOSTICS.md). Release 0.1.3 still requires a target-specific signup workflow implementation; WORKFLOW_NOT_CONFIGURED is displayed as Blocked with its reason.

## Source import history

See [development milestones and provenance](docs/DEVELOPMENT_HISTORY.md). The initial commit series imports modules from the current working tree; it is not recovered historical release snapshots.
