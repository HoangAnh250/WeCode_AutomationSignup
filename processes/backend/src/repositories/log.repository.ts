import type { Database } from '../infrastructure/database.js';
import type { PageInput } from '../core/pagination.js';
import { offset } from '../core/pagination.js';
export class LogRepository {
  constructor(private readonly db: Database) {}
  async list(input: PageInput & { category?: string }) {
    const where = {
      category: input.category,
      event: input.search ? { contains: input.search } : undefined,
    };
    const [items, total] = await this.db.$transaction([
      this.db.log.findMany({ where, ...offset(input), orderBy: { id: 'desc' } }),
      this.db.log.count({ where }),
    ]);
    return {
      items: items.map((x) => ({ ...x, id: x.id.toString() })),
      total,
      page: input.page,
      limit: input.limit,
    };
  }
}
