import type { Config } from '../core/config.js';
import type { Database } from '../infrastructure/database.js';
import type { Logger } from '../infrastructure/logger.js';
import { AesSecretCipher } from '../core/crypto.js';
import { taskEvent } from '../core/task-events.js';
import { CatchallManager } from '../services/identity.service.js';
import { WorkflowStateRepository } from './repositories/workflow-state.repository.js';
import { WeverseAdapter } from './WeverseAdapter.js';
import { WorkflowRegistry } from './WorkflowRegistry.js';
import { createEngine } from './create-engine.js';
export function createProductionEngine(config: Config, db: Database, logger: Logger) {
  const workflows = new WorkflowRegistry().register(
    new WeverseAdapter({
      store: new WorkflowStateRepository(db, new AesSecretCipher(config.ENCRYPTION_KEY)),
      identities: new CatchallManager(),
      otpSender: config.WEVERSE_OTP_SENDER,
      event: (execution, event) => taskEvent(db, event, execution.taskId, execution.runId),
    }),
  );
  return createEngine(config, db, logger, workflows);
}
