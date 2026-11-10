# Backend project structure

```text
backend/
|-- api/
|   `-- openapi.json
|-- docs/
|   |-- OPERATIONS.md
|   `-- VERIFICATION.md
|-- prisma/
|   |-- migrations/
|   |   |-- 202611070001_initial/
|   |   |   `-- migration.sql
|   |   `-- migration_lock.toml
|   `-- schema.prisma
|-- scripts/
|   `-- smoke.ts
|-- src/
|   |-- contracts/
|   |   `-- schemas.ts
|   |-- controllers/
|   |   |-- account.controller.ts
|   |   |-- email.controller.ts
|   |   |-- export.controller.ts
|   |   |-- helpers.ts
|   |   |-- identity.controller.ts
|   |   |-- proxy.controller.ts
|   |   `-- task.controller.ts
|   |-- core/
|   |   |-- config.ts
|   |   |-- crypto.ts
|   |   |-- errors.ts
|   |   |-- events.ts
|   |   |-- json.ts
|   |   `-- pagination.ts
|   |-- docs/
|   |   `-- generate-openapi.ts
|   |-- http/
|   |   |-- app.ts
|   |   |-- middleware.ts
|   |   `-- routes.ts
|   |-- infrastructure/
|   |   |-- database.ts
|   |   |-- imap.gateway.ts
|   |   |-- logger.ts
|   |   `-- proxy-probe.ts
|   |-- lib/
|   |   |-- otp.ts
|   |   `-- proxy-parser.ts
|   |-- queue/
|   |   |-- executor.ts
|   |   |-- outbox.ts
|   |   |-- processor.ts
|   |   |-- runtime.ts
|   |   `-- workers.ts
|   |-- repositories/
|   |   |-- account.repository.ts
|   |   |-- email.repository.ts
|   |   |-- export.repository.ts
|   |   |-- log.repository.ts
|   |   |-- proxy.repository.ts
|   |   |-- session.repository.ts
|   |   |-- task-run.repository.ts
|   |   `-- task.repository.ts
|   |-- services/
|   |   |-- account.service.ts
|   |   |-- email.service.ts
|   |   |-- export.service.ts
|   |   |-- identity.service.ts
|   |   |-- log.service.ts
|   |   |-- proxy.service.ts
|   |   |-- session.service.ts
|   |   `-- task.service.ts
|   |-- composition.ts
|   |-- server.ts
|   `-- worker.ts
|-- tests/
|   |-- integration/
|   |   `-- backend.test.ts
|   |-- support/
|   |   `-- worker.ts
|   `-- unit/
|       |-- core.test.ts
|       `-- proxy-probe.test.ts
|-- .env.example
|-- .prettierrc.json
|-- README.md
|-- compose.yaml
|-- package.json
|-- prisma.config.ts
|-- tsconfig.build.json
|-- tsconfig.json
`-- vitest.config.ts
```
