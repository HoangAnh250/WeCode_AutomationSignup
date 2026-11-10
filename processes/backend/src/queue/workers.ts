import { Worker } from 'bullmq';
import type { Database } from '../infrastructure/database.js';
import type { Config } from '../core/config.js';
import type { Logger } from '../infrastructure/logger.js';
import type { AutomationExecutor } from './executor.js';
import { createTaskProcessor } from './processor.js';
import { redisConnection } from './runtime.js';
export function startTaskWorker(
  db: Database,
  config: Config,
  logger: Logger,
  executor: AutomationExecutor,
) {
  const redis = redisConnection(config.REDIS_URL);
  redis.on('error', () =>
    logger.warn({ event: 'redis.connection_failed' }, 'Worker queue unavailable.'),
  );
  const controller = new AbortController();
  const worker = new Worker(
    'account-creation',
    createTaskProcessor(db, executor, controller.signal),
    {
      connection: redis,
      prefix: `wecode-${config.INSTALLATION_ID}`,
      concurrency: config.WORKER_CONCURRENCY,
      lockDuration: 60000,
      maxStalledCount: 1,
    },
  );
  worker.on('error', () =>
    logger.error({ event: 'queue.worker_error' }, 'Worker queue reported an error.'),
  );
  worker.on('failed', (job) =>
    logger.warn({ event: 'job.failed', jobId: job?.id }, 'Job failed; consult task history.'),
  );
  return {
    worker,
    async close() {
      controller.abort();
      await worker.close();
      redis.disconnect();
    },
  };
}
