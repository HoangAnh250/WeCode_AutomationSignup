BEGIN;
-- DropIndex
DROP INDEX "verification_requests_email_config_id_uid_validity_uid_key";

-- AlterTable
ALTER TABLE "email_configs" ADD COLUMN     "account_domain" VARCHAR(253),
ADD COLUMN     "mailbox" VARCHAR(128) NOT NULL DEFAULT 'INBOX';

-- AlterTable
ALTER TABLE "verification_requests" ADD COLUMN     "mailbox" VARCHAR(128) NOT NULL DEFAULT 'INBOX';

-- CreateIndex
CREATE UNIQUE INDEX "verification_requests_email_config_id_mailbox_uid_validity__key" ON "verification_requests"("email_config_id", "mailbox", "uid_validity", "uid");

COMMIT;
