import { taskEvent } from '../core/task-events.js';
import { randomUUID } from 'node:crypto';
import { UnrecoverableError, type Job } from 'bullmq';
import type { Database } from '../infrastructure/database.js';
import type { AutomationExecutor } from './executor.js';
import { executionContext } from './executor.js';
import { AppError, PauseSignal } from '../core/errors.js';
import { audit } from '../core/events.js';
export function createTaskProcessor(
  db: Database,
  executor: AutomationExecutor,
  signal: AbortSignal,
) {
  return async (job: Pick<Job<{ runId: string }>, 'data' | 'attemptsMade' | 'opts'>) => {
    const { runId } = job.data;
    if (typeof runId !== 'string') throw new UnrecoverableError('INVALID_JOB');
    const leaseToken = randomUUID();
    const claimed = await db.$transaction(async (tx) => {
      const run = await tx.taskRun.findUnique({ where: { id: runId } });
      if (!run) return null;
      await tx.$queryRaw`SELECT id FROM tasks WHERE id=${run.taskId}::uuid FOR UPDATE`;
      const task = await tx.task.findUnique({ where: { id: run.taskId } });
      const fresh = await tx.taskRun.findUnique({ where: { id: runId } });
      if (!task || !fresh || task.deletedAt || task.currentRunId !== runId) return null;
      if (fresh.status === 'RUNNING') {
        await tx.taskRun.update({
          where: { id: runId },
          data: {
            status: fresh.outcome === 'UNKNOWN' ? 'NEEDS_RECONCILIATION' : 'BLOCKED',
            errorCode: 'STALE_EXECUTION',
            retryable: false,
          },
        });
        await tx.task.update({
          where: { id: task.id },
          data: {
            status: fresh.outcome === 'UNKNOWN' ? 'NEEDS_RECONCILIATION' : 'BLOCKED',
            version: { increment: 1 },
          },
        });
        return null;
      }
      if (fresh.status !== 'QUEUED') return null;
      if (task.desiredState === 'paused') {
        await tx.taskRun.update({
          where: { id: runId },
          data: { status: 'PAUSED', finishedAt: new Date() },
        });
        await tx.task.update({
          where: { id: task.id },
          data: { status: 'PAUSED', version: { increment: 1 } },
        });
        return null;
      }
      await tx.taskRun.update({
        where: { id: runId },
        data: {
          status: 'RUNNING',
          leaseToken,
          errorCode: null,
          retryable: false,
          heartbeatAt: new Date(),
          startedAt: new Date(),
        },
      });
      await tx.task.update({
        where: { id: task.id },
        data: { status: 'RUNNING', version: { increment: 1 } },
      });
      await taskEvent(tx, 'task.worker_started', task.id, runId, { attempt: job.attemptsMade + 1 });
      return { task, run: fresh };
    });
    if (!claimed) return { ignored: true };
    const heartbeat = setInterval(() => {
      void db.taskRun
        .updateMany({
          where: { id: runId, leaseToken, status: 'RUNNING' },
          data: { heartbeatAt: new Date() },
        })
        .catch(() => {});
    }, 10000);
    try {
      await executor.execute(
        executionContext(
          db,
          runId,
          claimed.task.id,
          leaseToken,
          claimed.task.config,
          claimed.run.checkpoint,
          signal,
        ),
      );
      const result = await db.taskRun.findUnique({ where: { id: runId } });
      if (!result || result.outcome !== 'CREATED')
        throw new AppError(
          'NO_ACCOUNT_RESULT',
          'Executor completed without a persisted account result.',
          500,
          false,
        );
      await db.$transaction(async (tx) => {
        const owned = await tx.taskRun.updateMany({
          where: { id: runId, leaseToken, status: 'RUNNING' },
          data: { status: 'SUCCEEDED', errorCode: null, retryable: false, finishedAt: new Date() },
        });
        if (owned.count) {
          await tx.task.updateMany({
            where: { id: claimed.task.id, currentRunId: runId },
            data: { status: 'SUCCEEDED', version: { increment: 1 } },
          });
          await audit(tx, 'task.succeeded', claimed.task.id, { runId });
        }
      });
      return { completed: true };
    } catch (error) {
      const pause = error instanceof PauseSignal;
      const known = error instanceof AppError;
      const code = pause ? 'PAUSED' : known ? error.code : 'EXECUTION_FAILED';
      const retryable = known && error.retryable;
      let automaticRetry = false;
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM tasks WHERE id=${claimed.task.id}::uuid FOR UPDATE`;
        const fresh = await tx.taskRun.findUnique({ where: { id: runId } });
        const task = await tx.task.findUnique({ where: { id: claimed.task.id } });
        if (
          !fresh ||
          fresh.leaseToken !== leaseToken ||
          fresh.status !== 'RUNNING' ||
          task?.currentRunId !== runId
        )
          return;
        automaticRetry =
          !pause &&
          retryable &&
          fresh.outcome === 'NOT_CREATED' &&
          task.desiredState !== 'paused' &&
          job.attemptsMade + 1 < (job.opts.attempts ?? 1);
        const status =
          fresh.outcome === 'UNKNOWN'
            ? 'NEEDS_RECONCILIATION'
            : pause
              ? 'PAUSED'
              : ['AUTOMATION_NOT_INSTALLED', 'WORKFLOW_NOT_CONFIGURED'].includes(code)
                ? 'BLOCKED'
                : automaticRetry
                  ? 'QUEUED'
                  : 'FAILED';
        await tx.taskRun.update({
          where: { id: runId },
          data: {
            status,
            errorCode: code,
            retryable:
              !pause &&
              fresh.outcome === 'NOT_CREATED' &&
              (retryable || ['AUTOMATION_NOT_INSTALLED', 'WORKFLOW_NOT_CONFIGURED'].includes(code)),
            finishedAt: automaticRetry ? null : new Date(),
          },
        });
        await tx.task.update({
          where: { id: task.id },
          data: { status, version: { increment: 1 } },
        });
        await taskEvent(
          tx,
          'task.execution_stopped',
          task.id,
          runId,
          {
            code,
            status,
            outcome: fresh.outcome,
            retryable:
              !pause &&
              fresh.outcome === 'NOT_CREATED' &&
              (retryable || ['AUTOMATION_NOT_INSTALLED', 'WORKFLOW_NOT_CONFIGURED'].includes(code)),
          },
          pause ? 'info' : 'error',
        );
        if (automaticRetry)
          await taskEvent(
            tx,
            'task.retry_scheduled',
            task.id,
            runId,
            { attempt: job.attemptsMade + 2 },
            'warn',
          );
      });
      if (pause) return { paused: true };
      if (automaticRetry) throw new Error(code);
      throw new UnrecoverableError(code);
    } finally {
      clearInterval(heartbeat);
    }
  };
}
