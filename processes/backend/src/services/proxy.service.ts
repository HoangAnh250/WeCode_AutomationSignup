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
    await this.repo.db.$transaction([
      this.repo.db.proxyHealth.create({ data: { proxyId: id, ...result } }),
      this.repo.db.proxy.update({
        where: { id },
        data: { status: result.healthy ? 'healthy' : 'unreachable' },
      }),
    ]);
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
  async setEnabled(id: string, enabled: boolean) {
    return this.repo.db.proxy.update({ where: { id }, data: { enabled }, select: proxyPublic });
  }
}
