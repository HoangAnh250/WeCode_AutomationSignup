-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('DRAFT', 'QUEUED', 'RUNNING', 'PAUSE_REQUESTED', 'PAUSED', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'NEEDS_RECONCILIATION');

-- CreateEnum
CREATE TYPE "BusinessOutcome" AS ENUM ('NOT_CREATED', 'CREATED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "workflow" VARCHAR(40) NOT NULL DEFAULT 'create-account',
    "status" "TaskStatus" NOT NULL DEFAULT 'DRAFT',
    "desired_state" TEXT NOT NULL DEFAULT 'paused',
    "config" JSONB NOT NULL,
    "email_config_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "current_run_id" UUID,
    "create_key" VARCHAR(128),
    "request_hash" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_runs" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'QUEUED',
    "outcome" "BusinessOutcome" NOT NULL DEFAULT 'NOT_CREATED',
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "error_code" TEXT,
    "checkpoint" JSONB,
    "lease_token" UUID,
    "heartbeat_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "username" VARCHAR(80) NOT NULL,
    "password_cipher" TEXT NOT NULL,
    "proxy_used" VARCHAR(512),
    "status" VARCHAR(32) NOT NULL DEFAULT 'created',
    "task_run_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proxies" (
    "id" UUID NOT NULL,
    "protocol" VARCHAR(8) NOT NULL,
    "host" VARCHAR(253) NOT NULL,
    "port" INTEGER NOT NULL,
    "username_cipher" TEXT,
    "password_cipher" TEXT,
    "fingerprint" VARCHAR(64) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'unknown',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "total_uses" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proxies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proxy_health" (
    "id" UUID NOT NULL,
    "proxy_id" UUID NOT NULL,
    "healthy" BOOLEAN NOT NULL,
    "latency_ms" INTEGER,
    "error_code" TEXT,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proxy_health_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_configs" (
    "id" UUID NOT NULL,
    "inbox_address" VARCHAR(254) NOT NULL,
    "app_password_cipher" TEXT NOT NULL,
    "host" VARCHAR(253) NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 993,
    "status" VARCHAR(24) NOT NULL DEFAULT 'unknown',
    "version" INTEGER NOT NULL DEFAULT 1,
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_requests" (
    "id" UUID NOT NULL,
    "email_config_id" UUID NOT NULL,
    "recipient" VARCHAR(254) NOT NULL,
    "sender" VARCHAR(254) NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'waiting',
    "code_cipher" TEXT,
    "uid" TEXT,
    "uid_validity" TEXT,

    CONSTRAINT "verification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "payload_cipher" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logs" (
    "id" BIGSERIAL NOT NULL,
    "level" VARCHAR(12) NOT NULL,
    "category" VARCHAR(32) NOT NULL,
    "event" VARCHAR(100) NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tasks_create_key_key" ON "tasks"("create_key");

-- CreateIndex
CREATE INDEX "tasks_status_created_at_idx" ON "tasks"("status", "created_at");

-- CreateIndex
CREATE INDEX "task_runs_status_heartbeat_at_idx" ON "task_runs"("status", "heartbeat_at");

-- CreateIndex
CREATE UNIQUE INDEX "task_runs_task_id_attempt_key" ON "task_runs"("task_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE INDEX "accounts_status_created_at_id_idx" ON "accounts"("status", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "proxies_fingerprint_key" ON "proxies"("fingerprint");

-- CreateIndex
CREATE INDEX "proxies_enabled_status_last_used_at_idx" ON "proxies"("enabled", "status", "last_used_at");

-- CreateIndex
CREATE INDEX "proxy_health_proxy_id_checked_at_idx" ON "proxy_health"("proxy_id", "checked_at");

-- CreateIndex
CREATE INDEX "verification_requests_status_expires_at_idx" ON "verification_requests"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "verification_requests_email_config_id_uid_validity_uid_key" ON "verification_requests"("email_config_id", "uid_validity", "uid");

-- CreateIndex
CREATE INDEX "sessions_account_id_expires_at_idx" ON "sessions"("account_id", "expires_at");

-- CreateIndex
CREATE INDEX "logs_category_created_at_idx" ON "logs"("category", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_run_id_key" ON "outbox_events"("run_id");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_created_at_idx" ON "outbox_events"("published_at", "created_at");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_email_config_id_fkey" FOREIGN KEY ("email_config_id") REFERENCES "email_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_current_run_id_fkey" FOREIGN KEY ("current_run_id") REFERENCES "task_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_task_run_id_fkey" FOREIGN KEY ("task_run_id") REFERENCES "task_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxy_health" ADD CONSTRAINT "proxy_health_proxy_id_fkey" FOREIGN KEY ("proxy_id") REFERENCES "proxies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_email_config_id_fkey" FOREIGN KEY ("email_config_id") REFERENCES "email_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "task_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-level invariants complement application validation.
ALTER TABLE proxies ADD CONSTRAINT proxies_valid_port CHECK (port BETWEEN 1 AND 65535);
ALTER TABLE proxies ADD CONSTRAINT proxies_valid_protocol CHECK (protocol IN ('http','https','socks5'));
ALTER TABLE email_configs ADD CONSTRAINT email_configs_valid_port CHECK (port BETWEEN 1 AND 65535);
ALTER TABLE tasks ADD CONSTRAINT tasks_version_positive CHECK (version > 0);
ALTER TABLE task_runs ADD CONSTRAINT task_runs_attempt_positive CHECK (attempt > 0);
ALTER TABLE accounts ADD CONSTRAINT accounts_valid_status CHECK (status IN ('created','verified','disabled'));
ALTER TABLE verification_requests ADD CONSTRAINT verification_expiry_valid CHECK (expires_at > requested_at);
