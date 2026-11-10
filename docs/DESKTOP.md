# Electron desktop integration

## Structure

```text
WeCode/
  apps/desktop/
    main/
      index.ts           # Application/window lifecycle, protocol, menus and permissions
      ipc.ts             # Fixed IPC handlers, sender/frame checks and argument validation
      security.ts        # Trusted document, asset path policy and CSP
      backend.ts         # Main-only authenticated loopback HTTP client
      service.ts         # Adapter for the existing DesktopClient contract
      files.ts           # Native Save As and atomic file writes
      store.ts           # Persisted preferences and window bounds
      errors.ts          # Sanitized IPC errors
    preload/index.ts     # contextBridge facade; no generic invoke/filesystem API
    shared/contracts.ts  # IPC names, schemas and shared types
    resources/
      icon.svg           # Editable vector source for the WeCode icon
      icon.ico           # Multi-resolution Windows icon, 16 through 256 pixels
      icon.png           # 256-pixel icon
    tests/security.test.ts
    tsconfig.json
    dist/                # Generated main.cjs/preload.cjs
    renderer/            # Existing React application, unchanged
  scripts/
    build-electron.mjs
    dev-desktop.mjs
    generate-icon.ps1
    test-desktop-unit.mjs
    smoke-electron.mjs
  electron-builder.yml
  package.json
  release/               # Generated installer, portable and unpacked application
```

## Process boundaries

Renderer -> frozen window.wecode facade -> preload -> named IPC handler -> DesktopService -> existing backend API -> existing services/queue/database.

Main owns application lifecycle, the single-instance lock, dark native theme, BrowserWindow, native dialogs, loopback authentication, periodic refresh and local preference persistence. Preload translates only the already-defined DesktopClient operations; it does not expose ipcRenderer, arbitrary channels, filesystem access, child-process creation or the backend API token. All business state transitions remain in the backend. Desktop preferences are local UI/configuration data; existing worker concurrency and browser-pool capacity remain controlled by backend environment configuration. Main never silently rewrites that configuration or starts a second worker.

The compatibility adapter maps existing backend statuses and field names to the unchanged renderer contract. Detailed incremental progress/cookie counts, proxy auth metadata and elapsed execution time are not available in the existing list APIs; the shell does not add backend business endpoints to manufacture them. Only the existing account-creation workflow is accepted; unsupported workflow names fail explicitly. The engine's one-account-per-run restriction is unchanged.

## Security

BrowserWindow has contextIsolation=true, sandbox=true, nodeIntegration=false, webSecurity=true, webviewTag=false and no insecure-content allowance. Permission requests are denied. Popups/webviews, untrusted top-level navigation, redirects and renderer-initiated downloads are blocked. Native Save As is the supported export path; renderer code never supplies a destination path.

IPC validates the calling WebContents, main frame, exact application document and a per-method Zod argument schema. Requests have a 3 MB payload bound and a 32-operation concurrency limit. Errors return safe codes/messages rather than raw backend payloads or secret-bearing traces. The bridge is compatible with protocolVersion=1.

Production loads packaged assets via the secure standard wecode://desktop/index.html protocol with path containment and a restrictive CSP. It does not require a running Vite server. The production renderer has no HTTP connection capability; backend access occurs in main. Development permits only the fixed http://127.0.0.1:5173/ document and the Vite websocket, with development-only inline-script support for React refresh. Navigation is not allowed to turn that window into a general browser.

The backend client accepts only loopback HTTP origins, rejects redirects and credential-bearing URLs, applies request deadlines and caps responses at 32 MB. Credentials are never written to desktop-settings.json or exposed to React. This is a local single-user desktop administrative capability, not a new multi-user access-control system.

## Configuration and lifecycle

Main uses a native framed 1440x940 window, minimum 980x700, a dark background/native theme and the custom WeCode icon. It restores normal bounds/maximized state, checks saved bounds against available monitors and focuses the existing window on a second launch. Alt reveals native File/Edit/View menus; developer tools are available only in development. File -> Open application data opens the OS application-data directory.

Preferences and bounds are atomically persisted under app.getPath('userData')/desktop-settings.json. Closing a window waits for queued preference writes with a bounded shutdown deadline. The development launcher owns its Vite/Electron children and shuts down its server when Electron closes. Backend services remain independently managed.

Development reads API_TOKEN from processes/backend/.env in main only. Packaged builds never read that repository file. Set WECODE_API_TOKEN for a packaged client, and optionally WECODE_BACKEND_URL (default http://127.0.0.1:4317/). They must match the backend installation. Empty or unavailable services produce an empty workspace plus diagnostic logs, never preview data or fake success.

For tests only, NODE_ENV=test plus WECODE_TEST_USER_DATA_DIR isolates OS application data; WECODE_BACKEND_DISABLED=1 explicitly disconnects the backend. WECODE_SMOKE_DEV=1 runs the smoke script against a separately running Vite server. These switches are not used by release launch scripts.

## Packaging

The root package main points to apps/desktop/dist/main.cjs. esbuild bundles TypeScript main and sandbox-compatible CommonJS preload, with Electron/Node builtins external. No source-map secrets or runtime node_modules tree is required. electron-builder.yml whitelists compiled desktop files, renderer production assets and icons. It excludes .env files, tests and test reports. Installer generation does not package or deploy PostgreSQL, Redis, Playwright browsers or backend processes.

npm run build compiles production assets. npm run dist runs that build and emits both NSIS and portable Windows x64 targets. npm run dist:dir emits the unpacked app for inspection. Binaries are unsigned until a release certificate is configured using the normal electron-builder signing environment. No installer is automatically installed on the development machine.

The build dependency minimatch override is restricted to affected versions 7 through 10; legacy 3/5 consumers retain their compatible APIs. The pinned patched resolution is covered by actual installer generation. The root lockfile records all desktop dependencies.

## Verification

Verified with actual Electron on Windows, not a browser masquerading as desktop:

- Seven Node desktop tests: IPC schema validation, trusted origin, asset path bounds, loopback-only client, persisted preferences, disconnected behavior, filtered password export and error sanitization.
- Real Electron launch from compiled assets; all security preferences, visible native window, dark theme and minimum size checked through Electron APIs.
- Same smoke checks against Vite development mode.
- Unchanged React export button through actual preload/IPC and native file writer, using a controlled local backend fixture; saved password included, unselected rows omitted, account list free of passwords, invalid IPC rejected.
- Existing renderer Playwright suite remains separate and exercises the original React UI.
- Packaged app checked separately after build; generated archive must contain no .env or test payloads.

Fixtures do not create external accounts. Native Save As is stubbed only inside the automated smoke process so it can choose a temporary path without user input; the production code still uses the real dialog. A target-site workflow, production mailbox delivery, certificate signing and automatic backend installation are outside this desktop-shell change.

Official references: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [electron-builder Windows targets](https://www.electron.build/v26/docs/win/) and [NSIS/portable configuration](https://www.electron.build/v26/docs/nsis/).


## Completed verification: 2026-11-10

- npm run dev launched Vite and a visible native WeCode window; closing Electron stopped the launcher-owned server.
- npm run build and npm run dist completed successfully on Windows x64.
- Seven desktop tests, 14 unchanged renderer tests and 57 backend tests passed. Typechecks passed and npm audit reported zero vulnerabilities.
- Real Electron smoke checks passed in development mode and against release/win-unpacked/WeCode.exe, including native file service/password export through the existing React button.
- Packaged ASAR contained 35 entries and no .env, test code or backend source.
- Final NSIS installer and portable EXE generated in release/. Portable was launched directly and its visible WeCode window was observed.
- Installer execution/system installation was not performed. Artifacts are unsigned; backend services and target-site workflow prerequisites remain unchanged.


## Backend connection repair (0.1.2)

Start WeCode.cmd / npm run desktop:local launches the existing local services and passes the existing API token privately to the desktop process. The main process encrypts the connection token using Windows DPAPI via safeStorage and reloads it on later launches. URL validation stays loopback-only. A real Electron restart test removes both token/URL environment variables and verifies authenticated data access using the encrypted connection. Backend configuration still remains external to the installer; no credentials are bundled into ASAR.


Local proxy selection (0.1.2): new tasks default to Local (no proxy). The renderer choice maps to browser.proxyMode=direct, with no proxyId or proxy reservation even when healthy proxies exist. Auto assign remains separate. Proxy-bound persistent/saved profiles are rejected for Local rather than silently reusing their proxy. Verified by UI/adapter tests and actual browser/SQL assignment tests. Final regression: 16 UI tests, eight desktop tests and 68 backend tests passed.
