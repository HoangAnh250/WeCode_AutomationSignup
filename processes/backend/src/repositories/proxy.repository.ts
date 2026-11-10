import type { Database } from '../infrastructure/database.js';
import type { PageInput } from '../core/pagination.js';
import { offset } from '../core/pagination.js';
export const proxyPublic = {
  id: true,
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
    const where = { host: { contains: input.search, mode: 'insensitive' as const } };
    const [items, total] = await this.db.$transaction([
      this.db.proxy.findMany({
        where,
        select: proxyPublic,
        ...offset(input),
        orderBy: { createdAt: 'desc' },
      }),
      this.db.proxy.count({ where }),
    ]);
    return { items, total, page: input.page, limit: input.limit };
  }
  get(id: string) {
    return this.db.proxy.findUnique({ where: { id } });
  }
  async statistics() {
    const [total, healthy, disabled, usage] = await this.db.$transaction([
      this.db.proxy.count(),
      this.db.proxy.count({ where: { enabled: true, status: 'healthy' } }),
      this.db.proxy.count({ where: { enabled: false } }),
      this.db.proxy.aggregate({ _sum: { totalUses: true } }),
    ]);
    return { total, healthy, disabled, totalAssignments: usage._sum.totalUses ?? 0 };
  }
}
