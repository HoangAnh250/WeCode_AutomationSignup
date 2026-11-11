import { loadConfig } from './core/config.js';
import { createDatabase } from './infrastructure/database.js';
import { createLogger } from './infrastructure/logger.js';
import { createProductionEngine } from './automation/production-engine.js';
import { startTaskWorker } from './queue/workers.js';
const config = loadConfig();
const db = createDatabase(config.DATABASE_URL);
const logger = createLogger(config.LOG_LEVEL);
await db.$connect();
try {
  await db.workflowState.findFirst({ select: { taskId: true } });
} catch {
  logger.error(
    { event: 'worker.schema_unavailable' },
    'Workflow storage is unavailable. Run npm run db:migrate before starting the worker.',
  );
  await db.$disconnect();
  process.exit(1);
}
const engine = createProductionEngine(config, db, logger);
const runtime = startTaskWorker(db, config, logger, engine.executor);
logger.info(
  { event: 'worker.started', automationAvailable: true, workflows: engine.workflows.keys },
  'Queue worker and browser engine are ready.',
);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 30000);
  deadline.unref();
  await runtime.close();
  await engine.close();
  await db.$disconnect();
  clearTimeout(deadline);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
