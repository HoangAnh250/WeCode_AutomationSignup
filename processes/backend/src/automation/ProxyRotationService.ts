import type { Database } from '../infrastructure/database.js';
import type { ProxyAssignmentService } from './ProxyAssignmentService.js';
import type { LeaseOwner, ProxyLease } from './contracts.js';
import { AppError } from '../core/errors.js';
export class ProxyRotationService {
  constructor(
    private readonly db: Database,
    private readonly assignments: ProxyAssignmentService,
  ) {}
  async next(
    owner: LeaseOwner,
    input: { mode: 'direct' | 'auto' | 'fixed'; preferredId?: string; excludeIds?: string[] },
  ) {
    if (input.mode === 'direct') return undefined;
    return this.assignments.acquire(owner, input.preferredId, input.excludeIds);
  }
  async rotateBetweenExecutions(
    owner: LeaseOwner,
    old: ProxyLease,
    input: {
      browserClosed: boolean;
      outcome: 'NOT_CREATED' | 'CREATED' | 'UNKNOWN';
      sticky: boolean;
    },
  ) {
    const run = await this.db.taskRun.findUnique({ where: { id: owner.runId } });
    const sticky = await this.db.browserProfile.count({
      where: {
        ownerRunId: owner.runId,
        ownerToken: owner.token,
        state: 'leased',
        OR: [{ mode: 'persistent' }, { stateVersion: { gt: 0 } }],
      },
    });
    if (
      sticky > 0 ||
      !run ||
      run.leaseToken !== owner.token ||
      run.status !== 'RUNNING' ||
      run.outcome !== 'NOT_CREATED' ||
      !input.browserClosed ||
      input.sticky ||
      input.outcome !== 'NOT_CREATED'
    )
      throw new AppError(
        'UNSAFE_PROXY_ROTATION',
        'Proxy rotation requires a closed browser and no pending or created account.',
        409,
      );
    await this.assignments.release(old, 'rotated');
    return this.assignments.acquire(owner, undefined, [old.proxy.id]);
  }
  async preferredForRetry(
    runId: string,
    configuredId: string | undefined,
    rotateOnFailure: boolean,
    mode: 'direct' | 'auto' | 'fixed',
  ) {
    if (mode === 'direct') return { preferredId: undefined, excludeIds: [] };
    if (!rotateOnFailure || mode === 'fixed') return { preferredId: configuredId, excludeIds: [] };
    const run = await this.db.taskRun.findUnique({
      where: { id: runId },
      include: { task: { select: { config: true } } },
    });
    if (!run || run.outcome !== 'NOT_CREATED')
      throw new AppError('UNSAFE_PROXY_ROTATION', 'Cannot rotate after a side effect.', 409);
    const previous = await this.db.proxyAssignment.findMany({
      where: { runId, releasedAt: { not: null }, releaseReason: 'failed-before-commit' },
      select: { proxyId: true },
      orderBy: { createdAt: 'desc' },
      take: 16,
    });
    return { preferredId: configuredId, excludeIds: [...new Set(previous.map((p) => p.proxyId))] };
  }
}
