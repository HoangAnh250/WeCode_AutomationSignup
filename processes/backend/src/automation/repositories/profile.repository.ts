import { randomUUID } from 'node:crypto';
import type { Database } from '../../infrastructure/database.js';
import type { LeaseOwner, ProfileLease } from '../contracts.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
export const profileMetadata = {
  id: true,
  installationId: true,
  name: true,
  mode: true,
  state: true,
  assignedProxyId: true,
  stateVersion: true,
  lastActivityAt: true,
  browserVersion: true,
  createdAt: true,
} as const;
export class ProfileRepository {
  constructor(
    readonly db: Database,
    readonly installationId: string,
    readonly leaseSeconds: number,
  ) {}
  list() {
    return this.db.browserProfile.findMany({
      where: { installationId: this.installationId, deletedAt: null },
      select: profileMetadata,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }
  async create(name: string, mode: 'isolated' | 'persistent', proxyId?: string) {
    return this.db.browserProfile.create({
      data: {
        id: randomUUID(),
        installationId: this.installationId,
        name,
        mode,
        assignedProxyId: proxyId,
      },
      select: profileMetadata,
    });
  }
  async acquire(
    owner: LeaseOwner,
    id: string | undefined,
    taskId: string,
    mode: 'isolated' | 'persistent',
  ): Promise<ProfileLease> {
    return this.db.$transaction(async (tx) => {
      const run = await tx.taskRun.findUnique({
        where: { id: owner.runId },
        include: { task: { select: { currentRunId: true } } },
      });
      if (
        !run ||
        run.task.currentRunId !== run.id ||
        run.taskId !== taskId ||
        run.status !== 'RUNNING' ||
        run.leaseToken !== owner.token
      )
        throw conflict('Execution does not own an active run.');
      let profileId = id;
      if (!profileId) {
        const name = `task-${taskId}`;
        const existing = await tx.browserProfile.upsert({
          where: { installationId_name: { installationId: this.installationId, name } },
          create: { installationId: this.installationId, name, mode },
          update: {},
        });
        profileId = existing.id;
      }
      await tx.$queryRaw`SELECT id FROM browser_profiles WHERE id=${profileId}::uuid FOR UPDATE`;
      const profile = await tx.browserProfile.findUnique({ where: { id: profileId } });
      if (!profile || profile.deletedAt || profile.installationId !== this.installationId)
        throw notFound('Local browser profile');
      if (profile.state !== 'idle' || profile.ownerToken)
        throw new AppError(
          'PROFILE_BUSY',
          'Profile is leased or quarantined; it cannot be opened concurrently.',
          409,
          true,
        );
      await tx.browserProfile.update({
        where: { id: profileId },
        data: {
          state: 'leased',
          ownerRunId: owner.runId,
          ownerToken: owner.token,
          leaseExpiresAt: new Date(Date.now() + this.leaseSeconds * 1000),
          lastActivityAt: new Date(),
        },
      });
      return {
        id: profile.id,
        name: profile.name,
        mode: profile.mode as 'isolated' | 'persistent',
        installationId: this.installationId,
        assignedProxyId: profile.assignedProxyId,
        owner,
      };
    });
  }
  async renew(lease: ProfileLease) {
    const result = await this.db.browserProfile.updateMany({
      where: {
        id: lease.id,
        ownerRunId: lease.owner.runId,
        ownerToken: lease.owner.token,
        state: 'leased',
        leaseExpiresAt: { gt: new Date() },
      },
      data: {
        leaseExpiresAt: new Date(Date.now() + this.leaseSeconds * 1000),
        lastActivityAt: new Date(),
      },
    });
    return result.count === 1;
  }
  async release(lease: ProfileLease, quarantine = false) {
    const result = await this.db.browserProfile.updateMany({
      where: {
        id: lease.id,
        ownerRunId: lease.owner.runId,
        ownerToken: lease.owner.token,
        state: 'leased',
      },
      data: quarantine
        ? { state: 'quarantined', lastActivityAt: new Date() }
        : {
            state: 'idle',
            ownerRunId: null,
            ownerToken: null,
            leaseExpiresAt: null,
            lastActivityAt: new Date(),
          },
    });
    return result.count === 1;
  }
  async owned(lease: ProfileLease) {
    const p = await this.db.browserProfile.findFirst({
      where: {
        id: lease.id,
        ownerRunId: lease.owner.runId,
        ownerToken: lease.owner.token,
        state: 'leased',
        leaseExpiresAt: { gt: new Date() },
      },
    });
    if (!p)
      throw new AppError('PROFILE_LEASE_LOST', 'Profile ownership expired or changed.', 409, false);
    return p;
  }
  async saveState(lease: ProfileLease, stateCipher: string, browserVersion: string) {
    const result = await this.db.browserProfile.updateMany({
      where: {
        id: lease.id,
        ownerRunId: lease.owner.runId,
        ownerToken: lease.owner.token,
        state: 'leased',
        leaseExpiresAt: { gt: new Date() },
      },
      data: {
        stateCipher,
        stateVersion: { increment: 1 },
        browserVersion,
        lastActivityAt: new Date(),
      },
    });
    if (!result.count)
      throw new AppError(
        'PROFILE_LEASE_LOST',
        'Profile ownership changed before storage state could be saved.',
        409,
      );
  }
  async delete(id: string) {
    const result = await this.db.browserProfile.updateMany({
      where: { id, installationId: this.installationId, state: 'idle', deletedAt: null },
      data: { deletedAt: new Date(), state: 'deleted' },
    });
    if (!result.count) throw conflict('Only an idle local profile can be deleted.');
  }
  async assignProxy(id: string, proxyId: string | null) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM browser_profiles WHERE id=${id}::uuid FOR UPDATE`;
      const p = await tx.browserProfile.findUnique({ where: { id } });
      if (!p || p.deletedAt || p.installationId !== this.installationId) throw notFound('Profile');
      if (p.state !== 'idle')
        throw conflict('Proxy can be changed only while the profile is idle.');
      if (p.stateVersion > 0 && p.assignedProxyId !== proxyId)
        throw conflict(
          'A profile with saved state cannot silently change its proxy. Create a separate profile.',
        );
      return tx.browserProfile.update({
        where: { id },
        data: { assignedProxyId: proxyId },
        select: profileMetadata,
      });
    });
  }
  async bindProxy(lease: ProfileLease, proxyId: string | null) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM browser_profiles WHERE id=${lease.id}::uuid FOR UPDATE`;
      const p = await tx.browserProfile.findFirst({
        where: {
          id: lease.id,
          ownerToken: lease.owner.token,
          ownerRunId: lease.owner.runId,
          state: 'leased',
          leaseExpiresAt: { gt: new Date() },
        },
      });
      if (!p) throw conflict('Profile ownership changed.');
      if (p.stateVersion > 0 && p.assignedProxyId !== proxyId)
        throw new AppError(
          'PROFILE_PROXY_MISMATCH',
          'Saved browser identity must keep its assigned proxy.',
          409,
        );
      await tx.browserProfile.update({
        where: { id: lease.id },
        data: { assignedProxyId: proxyId },
      });
    });
  }
}
