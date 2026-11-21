import type { Database } from '../infrastructure/database.js';
import type { PageInput } from '../core/pagination.js';
import { offset } from '../core/pagination.js';
export const proxyPublic = {
  id: true,
  version: true,
  protocol: true,
  host: true,
  port: true,
  status: true,
  enabled: true,
  totalUses: true,
  lastUsedAt: true,
  createdAt: true,
} as const;
export class ProxyRepository {
  constructor(readonly db: Database) {}
  async list(input: PageInput) {
    const where = {
      deletedAt: null,
      host: { contains: input.search, mode: 'insensitive' as const },
    };
    const [items, total] = await this.db.$transaction([
      this.db.proxy.findMany({
        where,
        select: {
          ...proxyPublic,
          usernameCipher: true,
          health: { take: 1, orderBy: { checkedAt: 'desc' }, select: { latencyMs: true } },
          _count: { select: { assignments: { where: { releasedAt: null } } } },
        },
        ...offset(input),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.db.proxy.count({ where }),
    ]);
    return {
      items: items.map(({ usernameCipher, health, _count, ...item }) => ({
        ...item,
        hasAuthentication: Boolean(usernameCipher),
        latencyMs: item.status === 'unknown' ? null : (health[0]?.latencyMs ?? null),
        activeAssignments: _count.assignments,
      })),
      total,
      page: input.page,
      limit: input.limit,
    };
  }
  get(id: string) {
    return this.db.proxy.findFirst({ where: { id, deletedAt: null } });
  }
  async statistics() {
    const [total, healthy, disabled, usage] = await this.db.$transaction([
      this.db.proxy.count({ where: { deletedAt: null } }),
      this.db.proxy.count({ where: { enabled: true, status: 'healthy' } }),
      this.db.proxy.count({ where: { enabled: false, deletedAt: null } }),
      this.db.proxy.aggregate({ where: { deletedAt: null }, _sum: { totalUses: true } }),
    ]);
    return { total, healthy, disabled, totalAssignments: usage._sum.totalUses ?? 0 };
  }
}
