# Renderer IPC facade v1

Authoritative TypeScript contracts: `src/types/domain.ts` and `src/types/desktop.d.ts`.

The isolated preload exposes `window.wecode` with `protocolVersion: 1` and a `client` facade containing the methods below. The main process must validate sender, payload, workspace ownership and authoritative permissions. Renderer validation is not a security boundary.

| Method | Input | Result |
|---|---|---|
| getWorkspace | none | WorkspaceData snapshot |
| createTask | TaskInput | Promise<void> after confirmed application state |
| updateTask | task ID, TaskInput, expected revision | Promise<void> |
| deleteTask | task ID, expected revision | Promise<void> |
| taskAction | task ID, start/pause/resume, expected revision | Promise<void> after the action is confirmed |
| importProxies | normalized ProxyInput array | imported count |
| checkProxy | proxy ID | Promise<void>; authoritative result arrives via refresh/event |
| createProfile | name, proxy assignment | Promise<void> |
| deleteProfile | profile ID | Promise<void> |
| saveEmail | address, optional App Password | Promise<void>; absent password means retain existing secret |
| testEmail | none | Promise<void>; rejection contains a safe user-facing message |
| savePreferences | Preferences | Promise<void> |
| getLogs | none | latest bounded LogEntry array |
| exportAccounts | account IDs | Promise<void>; native save dialog/export handled outside renderer |
| exportLogs | log IDs | Promise<void>; native save dialog/export handled outside renderer |
| subscribe | listener | synchronous unsubscribe function |

## Events

- `data.changed`: invalidate and refresh the workspace snapshot.
- `log.created`: append a sanitized, unique-ID log entry; renderer retains at most 500.

This v1 frontend accepts full snapshots. The facade is a renderer integration boundary, not the raw low-level IPC wire protocol. The preload may translate internal request/command envelopes into these promises. If the internal command is asynchronous, resolve after confirmation or adapt the facade to expose requested states before integrating the real backend. Do not report a request-accepted response as an execution-completed response.

A task snapshot contains revision and allowedActions. It must not offer retry or resubmission across an uncertain account-creation boundary. The current renderer does not implement retry.

## Security and runtime

- Use contextIsolation, sandbox and no renderer Node integration in the eventual Electron shell.
- Each facade method maps to one explicitly allowlisted capability.
- Export cancellation should resolve without saving, or reject with a safe cancellation message.
- Never return mailbox passwords, proxy passwords, account passwords, cookie values or bearer tokens in workspace/log responses.
- Health probes, persistence, encryption and native file handling belong to desktop services.
- Export/file operations should use native dialogs in main; do not accept arbitrary renderer paths.
- Browser preview file inputs and downloads are development conveniences, not native desktop dialogs.
- Production without a valid facade displays a service-unavailable screen and never synthesizes records.
- Detach all event listeners when the subscription is disposed. Multi-workspace support requires workspace-scoped keys and events before extension.
