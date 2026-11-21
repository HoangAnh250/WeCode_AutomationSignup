import { isDeepStrictEqual } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import type { TaskCreate, TaskBatchCreate } from '../contracts/schemas.js';
import type { Transaction } from '../core/events.js';
import { audit } from '../core/events.js';
import { AppError, conflict, notFound } from '../core/errors.js';
import { json } from '../core/json.js';
import type { TaskRepository } from '../repositories/task.repository.js';
import type { Task } from '@prisma/client';
export class TaskManager {
  constructor(private readonly repo: TaskRepository) {}
  list(input: Parameters<TaskRepository['list']>[0]) {
    return this.repo.list(input);
  }
  get(id: string) {
    return this.repo.get(id);
  }
  async create(input: TaskCreate, key?: string) {
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    if (key) {
      const existing = await this.repo.db.task.findUnique({ where: { createKey: key } });
      if (existing) {
        if (existing.requestHash !== hash)
          throw conflict('Idempotency key was already used for different input.');
        return existing;
      }
    }
    try {
      return await this.repo.db.$transaction(async (tx) => {
        const task = await tx.task.create({
          data: {
            name: input.name,
            config: json(input.config),
            emailConfigId: input.emailConfigId,
            createKey: key,
            requestHash: key ? hash : undefined,
          },
        });
        await audit(tx, 'task.created', task.id);
        return task;
      });
    } catch (error) {
      if (key && (error as { code?: string }).code === 'P2002') {
        const existing = await this.repo.db.task.findUnique({ where: { createKey: key } });
        if (existing && existing.requestHash === hash) return existing;
      }
      throw error;
    }
  }
  async createBatch(input: TaskBatchCreate) {
    if (input.task.config.count !== 1)
      throw new AppError('INVALID_BATCH_TASK', 'Each batch row must create one account.', 422);
    if (input.task.config.browser?.profileId)
      throw new AppError(
        'BATCH_PROFILE_REQUIRES_AUTO',
        'Use Auto assign profiles so each batch row has an isolated profile.',
        422,
      );
    const prefix = `batch_${input.batchId}_`;
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const replay = async (tx: Pick<Transaction, 'task'>) => {
      const rows = await tx.task.findMany({
        where: { createKey: { startsWith: prefix } },
        select: { requestHash: true },
      });
      if (!rows.length) return false;
      if (rows.length !== input.size || rows.some((row) => row.requestHash !== hash))
        throw conflict('This batch identifier was already used for different input.');
      return true;
    };
    try {
      return await this.repo.db.$transaction(
        async (tx) => {
          if (await replay(tx))
            return { batchId: input.batchId, created: input.size, replayed: true };
          const data = Array.from({ length: input.size }, (_, offset) => ({
            id: randomUUID(),
            name:
              input.size === 1
                ? input.task.name
                : `${input.task.name.slice(0, 100)} [${String(offset + 1).padStart(String(input.size).length, '0')}/${input.size}]`,
            config: json({
              ...input.task.config,
              count: 1,
              batch: {
                id: input.batchId,
                index: offset + 1,
                size: input.size,
                name: input.task.name,
              },
            }),
            emailConfigId: input.task.emailConfigId,
            createKey: prefix + offset,
            requestHash: hash,
          }));
          await tx.task.createMany({ data });
          await audit(tx, 'task.batch_created', input.batchId, { size: input.size });
          return { batchId: input.batchId, created: input.size, replayed: false };
        },
        { timeout: 15000 },
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002' && (await replay(this.repo.db)))
        return { batchId: input.batchId, created: input.size, replayed: true };
      throw error;
    }
  }
  async update(id: string, input: TaskCreate, version: number) {
    return this.repo.locked(id, async (tx, task) => {
      this.version(task, version);
      if (!['DRAFT', 'PAUSED', 'FAILED', 'BLOCKED', 'SUCCEEDED'].includes(task.status))
        throw conflict('Task configuration cannot be changed in this state.');
      const run = task.currentRunId
        ? await tx.taskRun.findUnique({ where: { id: task.currentRunId } })
        : null;
      if (
        run &&
        run.outcome !== 'NOT_CREATED' &&
        !(task.status === 'SUCCEEDED' && run.outcome === 'CREATED')
      )
        throw conflict('A task with created or uncertain external state cannot be reconfigured.');
      const batch = (task.config as { batch?: unknown }).batch;
      const config = batch ? { ...input.config, batch } : input.config;
      const inputsChanged =
        !isDeepStrictEqual(task.config, config) ||
        task.emailConfigId !== (input.emailConfigId ?? null);
      const updated = await tx.task.update({
        where: { id },
        data: {
          ...(inputsChanged && task.status !== 'SUCCEEDED'
            ? { status: 'DRAFT' as const, currentRunId: null, desiredState: 'paused' }
            : {}),
          name: input.name,
          config: json(config),
          emailConfigId: input.emailConfigId ?? null,
          version: { increment: 1 },
        },
      });
      await audit(tx, 'task.updated', id);
      return updated;
    });
  }
  async delete(id: string, version: number) {
    return this.repo.locked(id, async (tx, task) => {
      this.version(task, version);
      if (['RUNNING', 'QUEUED', 'PAUSE_REQUESTED', 'NEEDS_RECONCILIATION'].includes(task.status))
        throw conflict('Stop at a safe checkpoint before deleting this task.');
      const run = task.currentRunId
        ? await tx.taskRun.findUnique({ where: { id: task.currentRunId } })
        : null;
      if (run?.outcome === 'UNKNOWN')
        throw conflict('Resolve the external outcome before deleting this task.');
      await tx.task.update({
        where: { id },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await audit(tx, 'task.deleted', id);
    });
  }
  async command(id: string, action: 'start' | 'pause' | 'resume' | 'retry', version: number) {
    return this.repo.locked(id, async (tx, task) => {
      this.version(task, version);
      const previous = task.currentRunId
        ? await tx.taskRun.findUnique({ where: { id: task.currentRunId } })
        : null;
      if (action === 'pause') {
        if (!['RUNNING', 'QUEUED', 'PAUSE_REQUESTED'].includes(task.status))
          throw conflict('Only queued or running tasks can be paused.');
        if (task.status === 'QUEUED' && previous) {
          await tx.taskRun.update({
            where: { id: previous.id },
            data: { status: 'PAUSED', finishedAt: new Date() },
          });
        }
        const status = task.status === 'QUEUED' ? 'PAUSED' : 'PAUSE_REQUESTED';
        const updated = await tx.task.update({
          where: { id },
          data: { desiredState: 'paused', status, version: { increment: 1 } },
        });
        await audit(tx, 'task.pause_requested', id);
        return updated;
      }
      if (action === 'start' && !['DRAFT', 'SUCCEEDED'].includes(task.status))
        throw conflict('Only draft or successfully completed tasks can be started.');
      if (action === 'resume' && task.status !== 'PAUSED')
        throw conflict('Only an acknowledged paused task can be resumed.');
      if (
        action === 'retry' &&
        (!['FAILED', 'BLOCKED'].includes(task.status) ||
          !(
            previous?.retryable ||
            [
              'OTP_AMBIGUOUS',
              'OTP_TIMEOUT',
              'WEVERSE_SELECTOR_CHANGED',
              'WEVERSE_CONSENT_NOT_SELECTED',
              'WEVERSE_SUBMISSION_MISMATCH',
            ].includes(previous?.errorCode ?? '')
          ) ||
          previous?.outcome !== 'NOT_CREATED')
      )
        throw conflict('This task cannot be retried safely. Reconciliation may be required.');
      if (task.status === 'NEEDS_RECONCILIATION' || previous?.outcome === 'UNKNOWN')
        throw conflict('Resolve the external outcome before restarting.');
      if (!task.emailConfigId)
        throw new AppError(
          'MAILBOX_REQUIRED',
          'Configure a mailbox before starting an account creation task.',
          422,
        );
      const mailbox = await tx.emailConfig.findUnique({ where: { id: task.emailConfigId } });
      if (!mailbox) throw notFound('Mailbox');
      const domain = (task.config as { domain?: string }).domain;
      if (mailbox.accountDomain && domain !== mailbox.accountDomain)
        throw new AppError(
          'ACCOUNT_DOMAIN_MISMATCH',
          'Task domain differs from the configured account domain. Update the task before starting.',
          422,
        );
      const freshCycle = action === 'start' && task.status === 'SUCCEEDED';
      let nextConfig = json(task.config);
      if (freshCycle) {
        if (
          !previous ||
          previous.outcome !== 'CREATED' ||
          !(await tx.account.findFirst({ where: { taskRunId: previous.id }, select: { id: true } }))
        )
          throw conflict('A saved successful account is required before starting a new cycle.');
        // Task row lock fences old executions. Keep runs/accounts, discard only the completed
        // identity journal. New cycles never inherit authentication from a previous account.
        await tx.workflowState.deleteMany({ where: { taskId: id } });
        const config = task.config as Record<string, unknown>;
        const browser = (config.browser ?? {}) as Record<string, unknown>;
        const {
          profileId: _profile,
          sessionId: _session,
          assignedProxyId: _assigned,
          ...options
        } = browser;
        nextConfig = json({ ...config, browser: { ...options, profileMode: 'isolated' } });
      }
      const attempt = task.attemptCount + 1;
      const run = await tx.taskRun.create({
        data: {
          taskId: id,
          attempt,
          checkpoint:
            action === 'resume' && previous?.checkpoint ? json(previous.checkpoint) : undefined,
          outcome: action === 'resume' && previous ? previous.outcome : 'NOT_CREATED',
        },
      });
      await tx.outboxEvent.create({ data: { runId: run.id } });
      const updated = await tx.task.update({
        where: { id },
        data: {
          config: json(nextConfig),
          currentRunId: run.id,
          attemptCount: attempt,
          desiredState: 'running',
          status: 'QUEUED',
          version: { increment: 1 },
        },
      });
      await audit(tx, `task.${action}`, id, { runId: run.id, freshCycle });
      return { ...updated, runId: run.id };
    });
  }
  private version(task: Task, expected: number) {
    if (task.version !== expected)
      throw conflict('Task changed. Refresh its version before sending another command.');
  }
}
