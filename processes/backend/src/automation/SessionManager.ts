import { randomUUID } from 'node:crypto';
import type { BrowserContext } from 'playwright';
import type { Database } from '../infrastructure/database.js';
import type { SecretCipher } from '../core/crypto.js';
import type { StorageStateManager } from './StorageStateManager.js';
import type { ProfileLease } from './contracts.js';
import { AppError, notFound } from '../core/errors.js';
export class SessionManager {
  constructor(
    private readonly db: Database,
    private readonly cipher: SecretCipher,
    private readonly storage: StorageStateManager,
    private readonly ttlSeconds: number,
  ) {}
  async save(
    lease: ProfileLease,
    context: BrowserContext,
    browserVersion: string,
    accountId: string,
    expiresAt?: Date,
  ) {
    const limit = Date.now() + this.ttlSeconds * 1000;
    const expires = expiresAt ? new Date(Math.min(expiresAt.getTime(), limit)) : new Date(limit);
    if (!Number.isFinite(expires.getTime()) || expires <= new Date())
      throw new AppError(
        'INVALID_SESSION_EXPIRY',
        'Session retention expiry must be in the future.',
        422,
      );
    const state = await this.storage.capture(lease, context, browserVersion);
    const id = randomUUID();
    return this.db.$transaction(async (tx) => {
      const profile = await tx.browserProfile.findFirst({
        where: {
          id: lease.id,
          ownerRunId: lease.owner.runId,
          ownerToken: lease.owner.token,
          state: 'leased',
          leaseExpiresAt: { gt: new Date() },
        },
      });
      if (!profile)
        throw new AppError(
          'PROFILE_LEASE_LOST',
          'Session cannot be saved without profile ownership.',
          409,
        );
      const account = await tx.account.findUnique({ where: { id: accountId } });
      if (!account) throw notFound('Account');
      if (account.taskRunId !== lease.owner.runId)
        throw new AppError(
          'SESSION_ACCOUNT_MISMATCH',
          'Account does not belong to this execution.',
          409,
        );
      return tx.session.create({
        data: {
          id,
          accountId,
          profileId: lease.id,
          expiresAt: expires,
          payloadCipher: this.cipher.seal(
            JSON.stringify({ kind: 'playwright', schemaVersion: 1, profileId: lease.id, state }),
            `session:${id}`,
          ),
        },
        select: { id: true, accountId: true, profileId: true, expiresAt: true, createdAt: true },
      });
    });
  }
  async load(sessionId: string, lease: ProfileLease) {
    await this.storage.assertOwned(lease);
    const session = await this.db.session.findUnique({
      where: { id: sessionId },
      include: { account: { select: { id: true, status: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date())
      throw new AppError('SESSION_UNAVAILABLE', 'Session is missing, revoked or expired.', 409);
    if (session.profileId !== lease.id || session.account.status === 'disabled')
      throw new AppError(
        'SESSION_PROFILE_MISMATCH',
        'Session belongs to a different profile or disabled account.',
        409,
      );
    let payload: { kind?: string; schemaVersion?: number; profileId?: string; state?: unknown };
    try {
      payload = JSON.parse(this.cipher.open(session.payloadCipher, `session:${session.id}`));
    } catch {
      throw new AppError('SESSION_CORRUPT', 'Session snapshot could not be authenticated.', 409);
    }
    if (
      payload.kind !== 'playwright' ||
      payload.schemaVersion !== 1 ||
      payload.profileId !== lease.id
    )
      throw new AppError(
        'SESSION_SCHEMA_MISMATCH',
        'Saved session is not a supported Playwright snapshot.',
        409,
      );
    return { accountId: session.accountId, state: this.storage.validate(payload.state) };
  }
  async restore(sessionId: string, lease: ProfileLease, context: BrowserContext) {
    const snapshot = await this.load(sessionId, lease);
    await context.setStorageState(snapshot.state);
    return snapshot.accountId;
  }
}
