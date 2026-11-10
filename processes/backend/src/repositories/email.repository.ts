import type { Database } from '../infrastructure/database.js';
export const emailPublic = {
  id: true,
  inboxAddress: true,
  accountDomain: true,
  mailbox: true,
  host: true,
  port: true,
  status: true,
  version: true,
  lastCheckedAt: true,
  createdAt: true,
} as const;
export class EmailRepository {
  constructor(readonly db: Database) {}
  list() {
    return this.db.emailConfig.findMany({
      select: emailPublic,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  get(id: string) {
    return this.db.emailConfig.findUnique({ where: { id } });
  }
}
