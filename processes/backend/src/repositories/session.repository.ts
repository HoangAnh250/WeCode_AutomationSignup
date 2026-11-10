import type { Database } from '../infrastructure/database.js';
export class SessionRepository {
  constructor(readonly db: Database) {}
  list(accountId: string) {
    return this.db.session.findMany({
      where: { accountId },
      select: { id: true, accountId: true, expiresAt: true, revokedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  create(input: { id: string; accountId: string; expiresAt: Date; payloadCipher: string }) {
    return this.db.session.create({
      data: input,
      select: { id: true, accountId: true, expiresAt: true, createdAt: true },
    });
  }
  revoke(id: string) {
    return this.db.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
