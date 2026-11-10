-- AlterTable
ALTER TABLE "proxies" ADD COLUMN     "capacity" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "profile_id" UUID;

-- CreateTable
CREATE TABLE "browser_profiles" (
    "id" UUID NOT NULL,
    "installation_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "mode" VARCHAR(16) NOT NULL DEFAULT 'isolated',
    "state" VARCHAR(24) NOT NULL DEFAULT 'idle',
    "assigned_proxy_id" UUID,
    "owner_run_id" UUID,
    "owner_token" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "state_cipher" TEXT,
    "state_version" INTEGER NOT NULL DEFAULT 0,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "browser_version" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "browser_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proxy_assignments" (
    "id" UUID NOT NULL,
    "proxy_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "owner_token" UUID NOT NULL,
    "lease_expires_at" TIMESTAMP(3) NOT NULL,
    "released_at" TIMESTAMP(3),
    "release_reason" VARCHAR(40),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proxy_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "browser_profiles_installation_id_state_idx" ON "browser_profiles"("installation_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "browser_profiles_installation_id_name_key" ON "browser_profiles"("installation_id", "name");

-- CreateIndex
CREATE INDEX "proxy_assignments_proxy_id_released_at_idx" ON "proxy_assignments"("proxy_id", "released_at");

-- CreateIndex
CREATE INDEX "proxy_assignments_run_id_owner_token_idx" ON "proxy_assignments"("run_id", "owner_token");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "browser_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_profiles" ADD CONSTRAINT "browser_profiles_assigned_proxy_id_fkey" FOREIGN KEY ("assigned_proxy_id") REFERENCES "proxies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxy_assignments" ADD CONSTRAINT "proxy_assignments_proxy_id_fkey" FOREIGN KEY ("proxy_id") REFERENCES "proxies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "proxies" ADD CONSTRAINT "proxy_capacity_positive" CHECK (capacity BETWEEN 1 AND 100);
ALTER TABLE "browser_profiles" ADD CONSTRAINT "browser_profile_mode_valid" CHECK (mode IN ('isolated','persistent'));
ALTER TABLE "browser_profiles" ADD CONSTRAINT "browser_profile_state_valid" CHECK (state IN ('idle','leased','quarantined','deleted'));
CREATE UNIQUE INDEX "proxy_assignment_active_owner_key" ON "proxy_assignments" (run_id,owner_token) WHERE released_at IS NULL;
