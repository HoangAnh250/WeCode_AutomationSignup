import { taskEvent } from '../core/task-events.js';
import type { Database } from '../infrastructure/database.js';
import type { QueuePort } from './runtime.js';
import type { Logger } from '../infrastructure/logger.js';
export class OutboxDispatcher {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private pending: Promise<void> | undefined;
  constructor(
    private readonly db: Database,
    private readonly queue: QueuePort,
    private readonly logger: Logger,
  ) {}
  async dispatch() {
    await this.db.$transaction(
      async (tx) => {
        const events = await tx.$queryRaw<
          { id: string; run_id: string }[]
        >`SELECT id,run_id FROM outbox_events WHERE published_at IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 20`;
        for (const event of events) {
          await this.queue.enqueue(event.run_id);
          const run = await tx.taskRun.findUnique({
            where: { id: event.run_id },
            select: { taskId: true },
          });
          if (run) await taskEvent(tx, 'task.job_enqueued', run.taskId, event.run_id);
          await tx.outboxEvent.update({
            where: { id: event.id },
            data: { publishedAt: new Date() },
          });
        }
      },
      { timeout: 15000 },
    );
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = async () => {
      try {
        await this.dispatch();
      } catch {
        this.logger.warn({ event: 'outbox.dispatch_failed' }, 'Queue dispatch will be retried.');
      } finally {
        if (!this.stopped)
          this.timer = setTimeout(() => {
            this.pending = tick();
          }, 1000);
      }
    };
    this.pending = tick();
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.pending;
  }
}
