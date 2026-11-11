import type { Database } from '../../infrastructure/database.js';
import type { SecretCipher } from '../../core/crypto.js';
import { AppError } from '../../core/errors.js';
import type { ExecutionContext } from '../../queue/executor.js';
import { weverseStateSchema, type WeverseState, type WeverseStateStore } from '../weverse/state.js';
import type { Transaction } from '../../core/events.js';

export class WorkflowStateRepository implements WeverseStateStore {
  constructor(
    private readonly db: Database,
    private readonly cipher: SecretCipher,
  ) {}
  private async owned(tx: Transaction, execution: ExecutionContext) {
    await tx.$queryRaw`SELECT id FROM tasks WHERE id=${execution.taskId}::uuid FOR UPDATE`;
    const task = await tx.task.findUnique({ where: { id: execution.taskId } });
    const run = await tx.taskRun.findUnique({ where: { id: execution.runId } });
    if (
      !task ||
      task.deletedAt ||
      task.currentRunId !== execution.runId ||
      !run ||
      run.taskId !== task.id ||
      run.leaseToken !== execution.leaseToken ||
      run.status !== 'RUNNING'
    )
      throw new AppError(
        'WORKFLOW_LEASE_LOST',
        'Workflow state is owned by another execution.',
        409,
      );
  }
  private decode(taskId: string, cipher: string) {
    try {
      return weverseStateSchema.parse(JSON.parse(this.cipher.open(cipher, `workflow:${taskId}`)));
    } catch {
      throw new AppError(
        'WORKFLOW_STATE_CORRUPT',
        'Encrypted workflow state could not be authenticated.',
        409,
      );
    }
  }
  async read(execution: ExecutionContext) {
    return this.db.$transaction(async (tx) => {
      await this.owned(tx, execution);
      const state = await tx.workflowState.findUnique({ where: { taskId: execution.taskId } });
      return state ? this.decode(execution.taskId, state.payloadCipher) : undefined;
    });
  }
  async mutate(
    execution: ExecutionContext,
    update: (state: WeverseState | undefined) => WeverseState,
  ) {
    return this.db.$transaction(async (tx) => {
      await this.owned(tx, execution);
      const existing = await tx.workflowState.findUnique({ where: { taskId: execution.taskId } });
      const state = weverseStateSchema.parse(
        update(existing ? this.decode(execution.taskId, existing.payloadCipher) : undefined),
      );
      const payloadCipher = this.cipher.seal(JSON.stringify(state), `workflow:${execution.taskId}`);
      await tx.workflowState.upsert({
        where: { taskId: execution.taskId },
        create: { taskId: execution.taskId, email: state.identity.email, payloadCipher },
        update: { email: state.identity.email, payloadCipher },
      });
      return state;
    });
  }
}
