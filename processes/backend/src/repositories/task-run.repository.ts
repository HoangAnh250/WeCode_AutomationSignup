import type { Database } from '../infrastructure/database.js';
import { notFound } from '../core/errors.js';
export class TaskRunRepository {
  constructor(private readonly db: Database) {}
  async get(id: string) {
    const run = await this.db.taskRun.findUnique({ where: { id } });
    if (!run) throw notFound('Task run');
    return run;
  }
}
