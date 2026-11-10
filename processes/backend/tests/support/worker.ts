import { startTaskWorker } from '../../src/queue/workers.js';
import { createLogger } from '../../src/infrastructure/logger.js';
export const createTaskWorkerForTest = (
  db: Parameters<typeof startTaskWorker>[0],
  config: Parameters<typeof startTaskWorker>[1],
  executor: Parameters<typeof startTaskWorker>[3],
) => startTaskWorker(db, config, createLogger('error'), executor);
