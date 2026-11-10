# Project structure

Published source tree. Dependencies, build output, release binaries, local credentials and runtime data are excluded.

```text
WeCode/
|-- apps/
|   `-- desktop/
|       |-- main/
|       |   |-- backend.ts
|       |   |-- connection.ts
|       |   |-- errors.ts
|       |   |-- files.ts
|       |   |-- index.ts
|       |   |-- ipc.ts
|       |   |-- security.ts
|       |   |-- service.ts
|       |   `-- store.ts
|       |-- preload/
|       |   `-- index.ts
|       |-- renderer/
|       |   |-- docs/
|       |   |   `-- IPC-CONTRACT.md
|       |   |-- src/
|       |   |   |-- app/
|       |   |   |   `-- App.tsx
|       |   |   |-- components/
|       |   |   |   |-- layout/
|       |   |   |   |   `-- Workbench.tsx
|       |   |   |   |-- shared/
|       |   |   |   |   |-- ConfirmDialog.tsx
|       |   |   |   |   |-- DataTable.tsx
|       |   |   |   |   |-- EmptyState.tsx
|       |   |   |   |   |-- Field.tsx
|       |   |   |   |   |-- PageHeader.tsx
|       |   |   |   |   `-- SearchInput.tsx
|       |   |   |   |-- tasks/
|       |   |   |   |   `-- TaskEditor.tsx
|       |   |   |   `-- ui/
|       |   |   |       |-- badge.tsx
|       |   |   |       |-- button.tsx
|       |   |   |       |-- dialog.tsx
|       |   |   |       `-- input.tsx
|       |   |   |-- hooks/
|       |   |   |   |-- useDebouncedValue.ts
|       |   |   |   |-- useDesktopEvents.ts
|       |   |   |   `-- useWorkspace.ts
|       |   |   |-- ipc/
|       |   |   |   `-- client.ts
|       |   |   |-- lib/
|       |   |   |   |-- proxy-parser.ts
|       |   |   |   |-- task-diagnostics.ts
|       |   |   |   `-- utils.ts
|       |   |   |-- modules/
|       |   |   |   |-- accounts/
|       |   |   |   |   `-- AccountsPage.tsx
|       |   |   |   |-- dashboard/
|       |   |   |   |   `-- DashboardPage.tsx
|       |   |   |   |-- email/
|       |   |   |   |   |-- EmailFlow.tsx
|       |   |   |   |   `-- EmailPage.tsx
|       |   |   |   |-- logs/
|       |   |   |   |   `-- LogsPage.tsx
|       |   |   |   |-- profiles/
|       |   |   |   |   `-- ProfilesPage.tsx
|       |   |   |   |-- proxies/
|       |   |   |   |   `-- ProxiesPage.tsx
|       |   |   |   |-- settings/
|       |   |   |   |   `-- SettingsPage.tsx
|       |   |   |   `-- tasks/
|       |   |   |       `-- TasksPage.tsx
|       |   |   |-- services/
|       |   |   |   |-- preview-client.ts
|       |   |   |   |-- preview-data.ts
|       |   |   |   `-- workspace-service.ts
|       |   |   |-- stores/
|       |   |   |   |-- log-view.store.ts
|       |   |   |   |-- notification.store.ts
|       |   |   |   `-- workbench.store.ts
|       |   |   |-- styles/
|       |   |   |   `-- globals.css
|       |   |   |-- types/
|       |   |   |   |-- desktop.d.ts
|       |   |   |   `-- domain.ts
|       |   |   `-- main.tsx
|       |   |-- tests/
|       |   |   `-- workbench.spec.ts
|       |   |-- .prettierrc.json
|       |   |-- components.json
|       |   |-- index.html
|       |   |-- package.json
|       |   |-- playwright.config.ts
|       |   |-- tsconfig.json
|       |   `-- vite.config.ts
|       |-- resources/
|       |   |-- icon.ico
|       |   |-- icon.png
|       |   `-- icon.svg
|       |-- shared/
|       |   `-- contracts.ts
|       |-- tests/
|       |   `-- security.test.ts
|       `-- tsconfig.json
|-- docs/
|   |-- screenshots/
|   |   |-- dashboard-desktop.png
|   |   |-- electron-desktop.png
|   |   |-- email-forwarding-flow.png
|   |   |-- email-integration-desktop.png
|   |   |-- task-blocked-diagnostic.png
|   |   |-- task-local-mode.png
|   |   `-- task-log-details.png
|   |-- DESKTOP.md
|   |-- DEVELOPMENT_HISTORY.md
|   |-- EMAIL_AUDIT.md
|   |-- TASK_DIAGNOSTICS.md
|   `-- VERIFICATION.md
|-- processes/
|   `-- backend/
|       |-- api/
|       |   `-- openapi.json
|       |-- docs/
|       |   |-- AUTOMATION_ENGINE.md
|       |   |-- OPERATIONS.md
|       |   `-- VERIFICATION.md
|       |-- prisma/
|       |   |-- migrations/
|       |   |   |-- 202611070001_initial/
|       |   |   |   `-- migration.sql
|       |   |   |-- 202611080001_browser_engine/
|       |   |   |   `-- migration.sql
|       |   |   |-- 202611100001_email_roles/
|       |   |   |   `-- migration.sql
|       |   |   `-- migration_lock.toml
|       |   `-- schema.prisma
|       |-- scripts/
|       |   `-- smoke.ts
|       |-- src/
|       |   |-- automation/
|       |   |   |-- repositories/
|       |   |   |   `-- profile.repository.ts
|       |   |   |-- async.ts
|       |   |   |-- BrowserManager.ts
|       |   |   |-- contracts.ts
|       |   |   |-- create-engine.ts
|       |   |   |-- EmailVerificationCoordinator.ts
|       |   |   |-- index.ts
|       |   |   |-- paths.ts
|       |   |   |-- ProfileManager.ts
|       |   |   |-- ProxyAssignmentService.ts
|       |   |   |-- ProxyRotationService.ts
|       |   |   |-- SessionManager.ts
|       |   |   |-- StorageStateManager.ts
|       |   |   |-- WorkerExecutor.ts
|       |   |   `-- WorkflowRegistry.ts
|       |   |-- contracts/
|       |   |   `-- schemas.ts
|       |   |-- controllers/
|       |   |   |-- account.controller.ts
|       |   |   |-- email.controller.ts
|       |   |   |-- export.controller.ts
|       |   |   |-- helpers.ts
|       |   |   |-- identity.controller.ts
|       |   |   |-- profile.controller.ts
|       |   |   |-- proxy.controller.ts
|       |   |   `-- task.controller.ts
|       |   |-- core/
|       |   |   |-- config.ts
|       |   |   |-- crypto.ts
|       |   |   |-- errors.ts
|       |   |   |-- events.ts
|       |   |   |-- json.ts
|       |   |   |-- pagination.ts
|       |   |   `-- task-events.ts
|       |   |-- docs/
|       |   |   `-- generate-openapi.ts
|       |   |-- http/
|       |   |   |-- app.ts
|       |   |   |-- middleware.ts
|       |   |   `-- routes.ts
|       |   |-- infrastructure/
|       |   |   |-- database.ts
|       |   |   |-- imap.gateway.ts
|       |   |   |-- logger.ts
|       |   |   `-- proxy-probe.ts
|       |   |-- lib/
|       |   |   |-- otp.ts
|       |   |   `-- proxy-parser.ts
|       |   |-- queue/
|       |   |   |-- executor.ts
|       |   |   |-- outbox.ts
|       |   |   |-- processor.ts
|       |   |   |-- runtime.ts
|       |   |   `-- workers.ts
|       |   |-- repositories/
|       |   |   |-- account.repository.ts
|       |   |   |-- email.repository.ts
|       |   |   |-- export.repository.ts
|       |   |   |-- log.repository.ts
|       |   |   |-- proxy.repository.ts
|       |   |   |-- session.repository.ts
|       |   |   |-- task-run.repository.ts
|       |   |   `-- task.repository.ts
|       |   |-- services/
|       |   |   |-- account.service.ts
|       |   |   |-- email.service.ts
|       |   |   |-- export.service.ts
|       |   |   |-- identity.service.ts
|       |   |   |-- log.service.ts
|       |   |   |-- proxy.service.ts
|       |   |   |-- session.service.ts
|       |   |   `-- task.service.ts
|       |   |-- composition.ts
|       |   |-- server.ts
|       |   `-- worker.ts
|       |-- tests/
|       |   |-- integration/
|       |   |   |-- backend.test.ts
|       |   |   `-- engine.test.ts
|       |   |-- support/
|       |   |   `-- worker.ts
|       |   `-- unit/
|       |       |-- browser-pool.test.ts
|       |       |-- core.test.ts
|       |       |-- forwarded-email.test.ts
|       |       `-- proxy-probe.test.ts
|       |-- .env.example
|       |-- .prettierrc.json
|       |-- compose.yaml
|       |-- package.json
|       |-- prisma.config.ts
|       |-- PROJECT_STRUCTURE.md
|       |-- README.md
|       |-- tsconfig.build.json
|       |-- tsconfig.json
|       `-- vitest.config.ts
|-- scripts/
|   |-- build-electron.mjs
|   |-- dev-desktop.mjs
|   |-- generate-icon.ps1
|   |-- smoke-electron.mjs
|   |-- start-local.mjs
|   `-- test-desktop-unit.mjs
|-- .gitattributes
|-- .gitignore
|-- electron-builder.yml
|-- package-lock.json
|-- package.json
|-- PROJECT_STRUCTURE.md
|-- README.md
`-- Start WeCode.cmd
```
