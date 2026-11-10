import type { Database } from '../infrastructure/database.js';
import type { z } from 'zod';
import { accountQuerySchema } from '../contracts/schemas.js';
import { offset } from '../core/pagination.js';
export type AccountQuery = z.infer<typeof accountQuerySchema>;
export const accountPublic = {
  id: true,
  email: true,
  username: true,
  proxyUsed: true,
  status: true,
  taskRunId: true,
  createdAt: true,
} as const;
export class AccountRepository {
  constructor(readonly db: Database) {}
  where(input: AccountQuery) {
    return {
      status: input.status,
      taskRunId: input.taskRunId,
      ...(input.search
        ? {
            OR: [
              { email: { contains: input.search, mode: 'insensitive' as const } },
              { username: { contains: input.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
  }
  async list(input: AccountQuery) {
    const where = this.where(input);
    const [items, total] = await this.db.$transaction([
      this.db.account.findMany({
        where,
        select: accountPublic,
        ...offset(input),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.db.account.count({ where }),
    ]);
    return { items, total, page: input.page, limit: input.limit };
  }
  get(id: string) {
    return this.db.account.findUnique({ where: { id } });
  }
}
