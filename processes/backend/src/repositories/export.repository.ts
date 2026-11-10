import type { AccountRepository, AccountQuery } from './account.repository.js';
export class ExportRepository {
  constructor(private readonly accounts: AccountRepository) {}
  batch(input: AccountQuery, cutoff: Date, cursor?: string) {
    return this.accounts.db.account.findMany({
      where: { ...this.accounts.where(input), createdAt: { lte: cutoff } },
      orderBy: { id: 'asc' },
      take: 250,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
}
