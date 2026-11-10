import type { Database } from '../infrastructure/database.js';
import type { Transaction } from './events.js';
import { json } from './json.js';
export async function taskEvent(
  db: Database | Transaction,
  event: string,
  taskId: string,
  runId: string,
  metadata: Record<string, unknown> = {},
  level: 'info' | 'warn' | 'error' = 'info',
) {
  await db.log.create({
    data: {
      level,
      category: 'task',
      event,
      entityId: taskId,
      metadata: json({ runId, ...metadata }),
    },
  });
}
