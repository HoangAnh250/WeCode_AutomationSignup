import { randomUUID } from 'node:crypto';
import type { SessionRepository } from '../repositories/session.repository.js';
import type { SecretCipher } from '../core/crypto.js';
import { AppError, notFound } from '../core/errors.js';
import { audit } from '../core/events.js';
export class SessionManager {
  constructor(
    private readonly repo: SessionRepository,
    private readonly cipher: SecretCipher,
  ) {}
  list(accountId: string) {
    return this.repo.list(accountId);
  }
  async save(accountId: string, payload: Record<string, unknown>, expiresAt: string) {
    const expires = new Date(expiresAt);
    if (expires <= new Date())
      throw new AppError('INVALID_EXPIRY', 'Session expiration must be in the future.', 422);
    const text = JSON.stringify(payload);
    if (Buffer.byteLength(text) > 500000)
      throw new AppError('SESSION_TOO_LARGE', 'Session exceeds the storage limit.', 413);
    const id = randomUUID();
    const session = await this.repo.create({
      id,
      accountId,
      expiresAt: expires,
      payloadCipher: this.cipher.seal(text, `session:${id}`),
    });
    await audit(this.repo.db, 'session.saved', id);
    return session;
  }
  async revoke(id: string) {
    const result = await this.repo.revoke(id);
    if (!result.count) throw notFound('Active session');
    await audit(this.repo.db, 'session.revoked', id);
  }
}
