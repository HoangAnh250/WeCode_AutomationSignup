import { AppError, PauseSignal, conflict } from '../core/errors.js';
import type { Database } from '../infrastructure/database.js';
import { json } from '../core/json.js';
export interface ExecutionContext {
  leaseToken: string;
  runId: string;
  taskId: string;
  config: unknown;
  checkpoint: unknown;
  signal: AbortSignal;
  assertCanContinue(): Promise<void>;
  saveCheckpoint(value: Record<string, unknown>): Promise<void>;
  beforeExternalMutation(): Promise<void>;
}
export interface AutomationExecutor {
  execute(context: ExecutionContext): Promise<void>;
}
export class MissingAutomationExecutor implements AutomationExecutor {
  async execute(_context: ExecutionContext): Promise<void> {
    throw new AppError(
      'AUTOMATION_NOT_INSTALLED',
      'No browser automation adapter is installed.',
      503,
      false,
    );
  }
}
export function executionContext(
  db: Database,
  runId: string,
  taskId: string,
  leaseToken: string,
  config: unknown,
  checkpoint: unknown,
  signal: AbortSignal,
): ExecutionContext {
  const assertCanContinue = async () => {
    if (signal.aborted)
      throw new AppError('WORKER_SHUTDOWN', 'Worker is shutting down.', 503, true);
    const [task, run] = await Promise.all([
      db.task.findUnique({ where: { id: taskId } }),
      db.taskRun.findUnique({ where: { id: runId } }),
    ]);
    if (
      !task ||
      !run ||
      task.currentRunId !== runId ||
      run.leaseToken !== leaseToken ||
      run.status !== 'RUNNING'
    )
      throw conflict('Execution no longer owns this task.');
    if (task.desiredState === 'paused') throw new PauseSignal();
  };
  const current: ExecutionContext = {
    leaseToken,
    runId,
    taskId,
    config,
    checkpoint,
    signal,
    assertCanContinue,
    async saveCheckpoint(value) {
      await assertCanContinue();
      const next = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM task_runs WHERE id=${runId}::uuid FOR UPDATE`;
        const run = await tx.taskRun.findUnique({ where: { id: runId } });
        if (!run || run.leaseToken !== leaseToken || run.status !== 'RUNNING')
          throw conflict('Execution lease was lost.');
        const previous =
          run.checkpoint && typeof run.checkpoint === 'object' && !Array.isArray(run.checkpoint)
            ? run.checkpoint
            : {};
        const merged = { ...previous, ...value };
        await tx.taskRun.update({
          where: { id: runId },
          data: { checkpoint: json(merged), heartbeatAt: new Date() },
        });
        return merged;
      });
      current.checkpoint = next;
    },
    async beforeExternalMutation() {
      await assertCanContinue();
      const updated = await db.taskRun.updateMany({
        where: { id: runId, leaseToken, status: 'RUNNING', outcome: 'NOT_CREATED' },
        data: { outcome: 'UNKNOWN', retryable: false },
      });
      if (!updated.count)
        throw conflict('An account creation action is already pending or completed.');
    },
  };
  return current;
}
