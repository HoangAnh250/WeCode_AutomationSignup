CREATE TABLE "workflow_states" (
    "task_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "payload_cipher" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workflow_states_pkey" PRIMARY KEY ("task_id")
);
CREATE UNIQUE INDEX "workflow_states_email_key" ON "workflow_states"("email");
ALTER TABLE "workflow_states" ADD CONSTRAINT "workflow_states_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
