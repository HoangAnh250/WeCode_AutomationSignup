import type { Transaction } from '../core/events.js';
import type { ProxyUpdate } from '../contracts/schemas.js';
import { createHmac, randomUUID } from 'node:crypto';
import type { ProxyRepository } from '../repositories/proxy.repository.js';
import { proxyPublic } from '../repositories/proxy.repository.js';
import type { SecretCipher } from '../core/crypto.js';
import type { ProxyProbe } from '../infrastructure/proxy-probe.js';
import { parseProxyImport } from '../lib/proxy-parser.js';
import { audit } from '../core/events.js';
import { AppError, notFound } from '../core/errors.js';
export class ProxyManager {
  constructor(
    private readonly repo: ProxyRepository,
    private readonly cipher: SecretCipher,
    private readonly probe: ProxyProbe,
    private readonly fingerprintKey: string,
  ) {}
  list(input: Parameters<ProxyRepository['list']>[0]) {
    return this.repo.list(input);
  }
  statistics() {
    return this.repo.statistics();
  }
  async import(content: string, format: 'json' | 'txt' | 'csv', dryRun: boolean) {
    const parsed = parseProxyImport(content, format);
    if (dryRun)
      return {
        valid: parsed.valid.map((p) => ({
          protocol: p.protocol,
          host: p.host,
          port: p.port,
          hasAuthentication: Boolean(p.username),
        })),
        errors: parsed.errors,
        duplicates: parsed.duplicates,
      };
    let imported = 0;
    let duplicates = parsed.duplicates;
    await this.repo.db.$transaction(
      async (tx) => {
        for (const p of parsed.valid) {
          const id = randomUUID();
          const fingerprint = createHmac('sha256', this.fingerprintKey)
            .update(JSON.stringify([p.protocol, p.host, p.port, p.username ?? '']))
            .digest('hex');
          const result = await tx.proxy.createMany({
            data: [
              {
                id,
                protocol: p.protocol,
                host: p.host,
                port: p.port,
                fingerprint,
                usernameCipher: p.username
                  ? this.cipher.seal(p.username, `proxy-user:${id}`)
                  : undefined,
                passwordCipher: p.password
                  ? this.cipher.seal(p.password, `proxy-pass:${id}`)
                  : undefined,
              },
            ],
            skipDuplicates: true,
          });
          imported += result.count;
          duplicates += 1 - result.count;
        }
        await audit(tx, 'proxy.imported', 'pool', {
          imported,
          duplicates,
          invalid: parsed.errors.length,
        });
      },
      { timeout: 30000 },
    );
    return { imported, duplicates, errors: parsed.errors };
  }
  async check(id: string) {
    const p = await this.repo.get(id);
    if (!p) throw notFound('Proxy');
    const result = await this.probe.check({
      protocol: p.protocol as 'http' | 'https' | 'socks5',
      host: p.host,
      port: p.port,
      username: p.usernameCipher
        ? this.cipher.open(p.usernameCipher, `proxy-user:${id}`)
        : undefined,
      password: p.passwordCipher
        ? this.cipher.open(p.passwordCipher, `proxy-pass:${id}`)
        : undefined,
    });
    await this.repo.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM proxies WHERE id=${id}::uuid FOR UPDATE`;
      const current = await tx.proxy.findUnique({ where: { id } });
      if (!current || current.deletedAt || current.version !== p.version)
        throw new AppError(
          'PROXY_CHANGED',
          'Proxy changed while its health check was running.',
          409,
        );
      await tx.proxyHealth.create({ data: { proxyId: id, ...result } });
      await tx.proxy.update({
        where: { id },
        data: { status: result.healthy ? 'healthy' : 'unreachable', version: { increment: 1 } },
      });
    });
    return result;
  }
  async rotate() {
    return this.repo.db.$transaction(async (tx) => {
      const selected = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM proxies WHERE enabled = true AND status = 'healthy' ORDER BY last_used_at ASC NULLS FIRST, id ASC FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!selected.length)
        throw new AppError('NO_HEALTHY_PROXY', 'No healthy proxy is available.', 409);
      const proxy = await tx.proxy.update({
        where: { id: selected[0].id },
        data: { totalUses: { increment: 1 }, lastUsedAt: new Date() },
        select: proxyPublic,
      });
      await audit(tx, 'proxy.selected', proxy.id);
      return proxy;
    });
  }
  healthHistory(id: string) {
    return this.repo.db.proxyHealth.findMany({
      where: { proxyId: id },
      orderBy: { checkedAt: 'desc' },
      take: 100,
    });
  }
  private async mutable(tx: Transaction, id: string, version?: number, editing = false) {
    // Same allocator lock order: allocations cannot target a proxy as it is removed.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(87640129)::text`;
    await tx.$queryRaw`SELECT id FROM proxies WHERE id=${id}::uuid FOR UPDATE`;
    const proxy = await tx.proxy.findUnique({ where: { id } });
    if (!proxy || proxy.deletedAt) throw notFound('Proxy');
    if (version !== undefined && proxy.version !== version)
      throw new AppError(
        'PROXY_CHANGED',
        'Proxy changed. Refresh before applying this command.',
        409,
      );
    const active = await tx.proxyAssignment.count({ where: { proxyId: id, releasedAt: null } });
    const leasedProfiles = await tx.browserProfile.count({
      where: { assignedProxyId: id, deletedAt: null, state: { not: 'idle' } },
    });
    const reserved = await tx.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM tasks WHERE deleted_at IS NULL
      AND (status NOT IN ('SUCCEEDED','FAILED','BLOCKED') OR EXISTS (SELECT 1 FROM task_runs r WHERE r.id=tasks.current_run_id AND r.outcome='UNKNOWN'))
      AND (config->>'proxyId'=${id} OR config->'browser'->>'assignedProxyId'=${id})`;
    if (active || leasedProfiles || Number(reserved[0].count))
      throw new AppError(
        'PROXY_IN_USE',
        'Proxy is used by an active, queued, paused or unresolved task/profile. Stop or unassign it first.',
        409,
      );
    if (
      editing &&
      (await tx.browserProfile.count({
        where: { assignedProxyId: id, deletedAt: null, stateVersion: { gt: 0 } },
      }))
    )
      throw new AppError(
        'PROXY_HAS_SAVED_STATE',
        'A saved browser identity uses this proxy. Use a new proxy entry or remove the saved profile first.',
        409,
      );
    return proxy;
  }
  async update(id: string, input: ProxyUpdate) {
    try {
      return await this.repo.db.$transaction(async (tx) => {
        const proxy = await this.mutable(tx, id, input.version, true);
        const username =
          input.authMode === 'replace'
            ? input.username!
            : input.authMode === 'remove'
              ? undefined
              : proxy.usernameCipher
                ? this.cipher.open(proxy.usernameCipher, `proxy-user:${id}`)
                : undefined;
        const host = (input.host ?? proxy.host).replace(/^\[|\]$/g, '').toLowerCase();
        const port = input.port ?? proxy.port;
        const protocol = input.protocol ?? proxy.protocol;
        const fingerprint = createHmac('sha256', this.fingerprintKey)
          .update(JSON.stringify([protocol, host, port, username ?? '']))
          .digest('hex');
        const changed =
          host !== proxy.host ||
          port !== proxy.port ||
          protocol !== proxy.protocol ||
          input.authMode !== 'keep';
        const updated = await tx.proxy.update({
          where: { id },
          data: {
            host,
            port,
            protocol,
            fingerprint,
            ...(input.authMode !== 'keep'
              ? {
                  usernameCipher: username ? this.cipher.seal(username, `proxy-user:${id}`) : null,
                  passwordCipher:
                    input.authMode === 'replace'
                      ? this.cipher.seal(input.password!, `proxy-pass:${id}`)
                      : null,
                }
              : {}),
            ...(changed ? { status: 'unknown' } : {}),
            version: { increment: 1 },
          },
          select: proxyPublic,
        });
        await audit(tx, 'proxy.updated', id);
        return updated;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        throw new AppError(
          'PROXY_DUPLICATE',
          'This proxy endpoint and username already exist.',
          409,
        );
      throw error;
    }
  }
  async delete(id: string, version: number) {
    return this.repo.db.$transaction(async (tx) => {
      await this.mutable(tx, id, version);
      // Keep historical leases and saved-account references; free the import fingerprint.
      await tx.proxy.update({
        where: { id },
        data: {
          enabled: false,
          deletedAt: new Date(),
          version: { increment: 1 },
          fingerprint: createHmac('sha256', this.fingerprintKey)
            .update(`deleted:${id}`)
            .digest('hex'),
        },
      });
      await audit(tx, 'proxy.deleted', id);
    });
  }
  async setEnabled(id: string, enabled: boolean) {
    return this.repo.db.$transaction(async (tx) => {
      await this.mutable(tx, id);
      return tx.proxy.update({
        where: { id },
        data: { enabled, version: { increment: 1 } },
        select: proxyPublic,
      });
    });
  }
}
