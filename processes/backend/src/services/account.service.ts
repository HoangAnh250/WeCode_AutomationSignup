import { randomUUID } from 'node:crypto';
import type { AccountRepository, AccountQuery } from '../repositories/account.repository.js';
import { accountPublic } from '../repositories/account.repository.js';
import type { SecretCipher } from '../core/crypto.js';
import type { AccountCreate } from '../contracts/schemas.js';
import { audit } from '../core/events.js';
import { notFound, conflict } from '../core/errors.js';
export class AccountManager {
  constructor(
    readonly repo: AccountRepository,
    private readonly cipher: SecretCipher,
  ) {}
  list(input: AccountQuery) {
    return this.repo.list(input);
  }
  async get(id: string) {
    const account = await this.repo.get(id);
    if (!account) throw notFound('Account');
    const { passwordCipher, ...result } = account;
    return { ...result, hasPassword: true };
  }
  async create(input: AccountCreate, expectedLeaseToken?: string) {
    const id = randomUUID();
    return this.repo.db.$transaction(async (tx) => {
      if (input.taskRunId) {
        await tx.$queryRaw`SELECT id FROM task_runs WHERE id=${input.taskRunId}::uuid FOR UPDATE`;
        const run = await tx.taskRun.findUnique({ where: { id: input.taskRunId } });
        if (!run) throw notFound('Task run');
        if (
          run.status !== 'RUNNING' ||
          (expectedLeaseToken &&
            (run.leaseToken !== expectedLeaseToken || run.outcome !== 'UNKNOWN'))
        )
          throw conflict('Account results must belong to a running execution.');
      }
      const account = await tx.account.create({
        data: {
          id,
          email: input.email,
          username: input.username,
          passwordCipher: this.cipher.seal(input.password, `account:${id}`),
          proxyUsed: input.proxyUsed,
          status: input.status,
          taskRunId: input.taskRunId,
        },
        select: accountPublic,
      });
      if (input.taskRunId)
        await tx.taskRun.update({
          where: { id: input.taskRunId },
          data: { outcome: 'CREATED', retryable: false },
        });
      await audit(tx, 'account.saved', id);
      return account;
    });
  }
  async password(id: string) {
    const a = await this.repo.get(id);
    if (!a) throw notFound('Account');
    await audit(this.repo.db, 'account.password_revealed', id);
    return this.cipher.open(a.passwordCipher, `account:${id}`);
  }
  decrypt(id: string, value: string) {
    return this.cipher.open(value, `account:${id}`);
  }
}
