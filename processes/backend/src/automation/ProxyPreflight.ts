import type { Database } from '../infrastructure/database.js';
import type { ProxyManager } from '../services/proxy.service.js';
import type { ExecutionContext } from '../queue/executor.js';
import { taskConfigSchema } from '../contracts/schemas.js';
import { allocateAutomaticProxy } from '../services/auto-proxy-allocation.js';
import { AppError } from '../core/errors.js';
import { json } from '../core/json.js';

export class ProxyPreflight {
  private checks = new Map<string, Promise<void>>();
  constructor(
    private readonly db: Database,
    private readonly proxies: ProxyManager,
    private readonly poolFreshnessMs = 15000,
  ) {}

  private checkOnce(id: string) {
    const pending = this.checks.get(id);
    if (pending) return pending;
    const flight = this.proxies
      .check(id)
      .then(() => {})
      .catch((error) => {
        if (!(error instanceof AppError) || !['PROXY_CHANGED', 'NOT_FOUND'].includes(error.code))
          throw error;
      })
      .finally(() => {
        if (this.checks.get(id) === flight) this.checks.delete(id);
      });
    this.checks.set(id, flight);
    return flight;
  }
  async preparePool(canContinue: () => Promise<void> = async () => {}) {
    const pool = await this.db.proxy.findMany({
      where: {
        enabled: true,
        deletedAt: null,
        NOT: { protocol: 'socks5', usernameCipher: { not: null } },
      },
      select: {
        id: true,
        status: true,
        health: { orderBy: { checkedAt: 'desc' }, take: 1, select: { checkedAt: true } },
      },
    });
    const stale = pool.filter(
      (proxy) =>
        proxy.status === 'unknown' ||
        !proxy.health[0] ||
        Date.now() - proxy.health[0].checkedAt.getTime() > this.poolFreshnessMs,
    );
    let next = 0;
    const worker = async () => {
      while (next < stale.length) {
        await canContinue();
        const proxy = stale[next++];
        if (proxy) await this.checkOnce(proxy.id);
      }
    };
    const outcomes = await Promise.allSettled(
      Array.from({ length: Math.min(4, stale.length) }, worker),
    );
    const failed = outcomes.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failed) throw failed.reason;
  }

  async reserve(execution: ExecutionContext) {
    await this.preparePool(() => execution.assertCanContinue());
    await execution.assertCanContinue();
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tasks WHERE id=${execution.taskId}::uuid FOR UPDATE`;
      const task = await tx.task.findUnique({ where: { id: execution.taskId } });
      const run = await tx.taskRun.findUnique({ where: { id: execution.runId } });
      if (
        !task ||
        task.deletedAt ||
        task.currentRunId !== execution.runId ||
        !run ||
        run.status !== 'RUNNING' ||
        run.leaseToken !== execution.leaseToken ||
        run.outcome !== 'NOT_CREATED'
      )
        throw new AppError(
          'RESOURCE_LEASE_LOST',
          'Execution no longer owns proxy preparation.',
          409,
        );
      let current = taskConfigSchema.parse(task.config);
      const previousId = current.browser?.assignedProxyId;
      if (previousId && current.browser?.profileMode !== 'persistent') {
        const available = await tx.proxy.findFirst({
          where: { id: previousId, enabled: true, deletedAt: null, status: 'healthy' },
          select: { id: true },
        });
        if (!available) {
          const generation = await tx.taskRun.count({
            where: { taskId: task.id, status: 'SUCCEEDED' },
          });
          const name = generation ? `task-${task.id}-cycle-${generation + 1}` : `task-${task.id}`;
          const saved = await tx.browserProfile.count({
            where: { name, deletedAt: null, stateVersion: { gt: 0 } },
          });
          // Only replace an automatic reservation with no saved browser identity.
          // Resume/session bindings must keep their existing network identity.
          if (!saved)
            current = { ...current, browser: { ...current.browser!, assignedProxyId: undefined } };
        }
      }
      const assigned = await allocateAutomaticProxy(tx, task.id, current);
      if (assigned.browser?.assignedProxyId !== previousId)
        await tx.task.update({
          where: { id: task.id },
          data: { config: json(assigned), version: { increment: 1 } },
        });
      return assigned;
    });
  }

  async checkAssigned(id: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await this.proxies.check(id);
        if (!result.healthy)
          throw new AppError(
            'PROXY_HEALTH_CHECK_FAILED',
            'Assigned proxy failed its connection check before browser startup.',
            503,
            true,
          );
        return;
      } catch (error) {
        if (error instanceof AppError && error.code === 'PROXY_CHANGED' && attempt === 0) continue;
        throw error;
      }
    }
  }
}
