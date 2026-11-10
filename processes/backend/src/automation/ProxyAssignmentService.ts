import { Prisma } from '@prisma/client';
import type { Database } from '../infrastructure/database.js';
import type { SecretCipher } from '../core/crypto.js';
import type { LeaseOwner, ProxyLease } from './contracts.js';
import { AppError, conflict } from '../core/errors.js';
export class ProxyAssignmentService {
  constructor(
    private readonly db: Database,
    private readonly cipher: SecretCipher,
    private readonly leaseSeconds: number,
  ) {}
  async acquire(
    owner: LeaseOwner,
    preferredId?: string,
    excludeIds: string[] = [],
  ): Promise<ProxyLease> {
    return this.db.$transaction(async (tx) => {
      const run = await tx.taskRun.findUnique({
        where: { id: owner.runId },
        include: { task: { select: { currentRunId: true } } },
      });
      if (
        !run ||
        run.status !== 'RUNNING' ||
        run.leaseToken !== owner.token ||
        run.task.currentRunId !== run.id
      )
        throw conflict('Execution cannot acquire a proxy after ownership was lost.');
      const excluded = excludeIds.length
        ? Prisma.sql`AND p.id NOT IN (${Prisma.join(excludeIds.map((id) => Prisma.sql`${id}::uuid`))})`
        : Prisma.empty;
      const requested = preferredId ? Prisma.sql`AND p.id=${preferredId}::uuid` : Prisma.empty;
      const ids = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT p.id FROM proxies p WHERE p.enabled=true AND p.status='healthy' AND (SELECT count(*) FROM proxy_assignments a WHERE a.proxy_id=p.id AND a.released_at IS NULL)<p.capacity ${requested} ${excluded} ORDER BY p.last_used_at ASC NULLS FIRST,p.id ASC FOR UPDATE SKIP LOCKED LIMIT 16`,
      );
      for (const candidate of ids) {
        const proxy = await tx.proxy.findUniqueOrThrow({ where: { id: candidate.id } });
        const inUse = await tx.proxyAssignment.count({
          where: { proxyId: proxy.id, releasedAt: null },
        });
        if (inUse >= proxy.capacity) continue;
        if (proxy.protocol === 'socks5' && proxy.usernameCipher) {
          if (preferredId)
            throw new AppError(
              'SOCKS_AUTH_UNSUPPORTED',
              'Authenticated SOCKS5 requires a separately configured HTTP bridge for Chromium.',
              422,
            );
          continue;
        }
        const assignment = await tx.proxyAssignment.create({
          data: {
            proxyId: proxy.id,
            runId: owner.runId,
            ownerToken: owner.token,
            leaseExpiresAt: new Date(Date.now() + this.leaseSeconds * 1000),
          },
        });
        await tx.proxy.update({
          where: { id: proxy.id },
          data: { lastUsedAt: new Date(), totalUses: { increment: 1 } },
        });
        const host = proxy.host.includes(':') ? `[${proxy.host}]` : proxy.host;
        return {
          id: assignment.id,
          owner,
          proxy: {
            id: proxy.id,
            server: `${proxy.protocol}://${host}:${proxy.port}`,
            username: proxy.usernameCipher
              ? this.cipher.open(proxy.usernameCipher, `proxy-user:${proxy.id}`)
              : undefined,
            password: proxy.passwordCipher
              ? this.cipher.open(proxy.passwordCipher, `proxy-pass:${proxy.id}`)
              : undefined,
          },
        };
      }
      throw new AppError(
        'NO_PROXY_CAPACITY',
        'No compatible healthy proxy has an available assignment slot.',
        503,
        true,
      );
    });
  }
  async assertOwned(lease: ProxyLease) {
    const active = await this.db.proxyAssignment.findFirst({
      where: {
        id: lease.id,
        runId: lease.owner.runId,
        ownerToken: lease.owner.token,
        releasedAt: null,
        leaseExpiresAt: { gt: new Date() },
      },
    });
    if (!active)
      throw new AppError('PROXY_LEASE_LOST', 'Proxy ownership expired or changed.', 409, false);
  }
  async renew(lease: ProxyLease) {
    const result = await this.db.proxyAssignment.updateMany({
      where: {
        id: lease.id,
        runId: lease.owner.runId,
        ownerToken: lease.owner.token,
        releasedAt: null,
        leaseExpiresAt: { gt: new Date() },
      },
      data: { leaseExpiresAt: new Date(Date.now() + this.leaseSeconds * 1000) },
    });
    return result.count === 1;
  }
  async release(lease: ProxyLease, reason = 'released') {
    const result = await this.db.proxyAssignment.updateMany({
      where: {
        id: lease.id,
        runId: lease.owner.runId,
        ownerToken: lease.owner.token,
        releasedAt: null,
      },
      data: { releasedAt: new Date(), releaseReason: reason },
    });
    return result.count === 1;
  }
  async active() {
    return this.db.proxyAssignment.findMany({
      where: { releasedAt: null },
      select: { id: true, proxyId: true, runId: true, createdAt: true, leaseExpiresAt: true },
      take: 500,
    });
  }
}
