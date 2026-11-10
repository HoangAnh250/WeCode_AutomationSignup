import type { Database } from '../infrastructure/database.js';
import type { Transaction } from '../core/events.js';
import { notFound } from '../core/errors.js';
import type { PageInput } from '../core/pagination.js';
import { offset } from '../core/pagination.js';
export class TaskRepository {
  constructor(readonly db: Database) {}
  async locked<T>(
    id: string,
    fn: (
      tx: Transaction,
      task: NonNullable<Awaited<ReturnType<Database['task']['findUnique']>>>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${id}::uuid FOR UPDATE`;
      const task = await tx.task.findUnique({ where: { id } });
      if (!task || task.deletedAt) throw notFound('Task');
      return fn(tx, task);
    });
  }
  async list(input: PageInput) {
    const where = {
      deletedAt: null,
      name: { contains: input.search, mode: 'insensitive' as const },
    };
    const [items, total] = await this.db.$transaction([
      this.db.task.findMany({
        where,
        include: {
          currentRun: {
            select: {
              id: true,
              status: true,
              errorCode: true,
              retryable: true,
              outcome: true,
              startedAt: true,
              finishedAt: true,
            },
          },
        },
        ...offset(input),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.db.task.count({ where }),
    ]);
    return { items, total, page: input.page, limit: input.limit };
  }
  async get(id: string) {
    const task = await this.db.task.findUnique({
      where: { id },
      include: { runs: { orderBy: { attempt: 'desc' }, take: 20 } },
    });
    if (!task || task.deletedAt) throw notFound('Task');
    return task;
  }
}
