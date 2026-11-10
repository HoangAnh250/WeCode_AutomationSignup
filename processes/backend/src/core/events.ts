import type { Database } from '../infrastructure/database.js';
import type { Prisma } from '@prisma/client';
import { json } from './json.js';
export type Transaction = Prisma.TransactionClient;
export async function audit(
  db: Transaction | Database,
  event: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  await db.log.create({
    data: { level: 'info', category: 'audit', event, entityId, metadata: json(metadata) },
  });
}
