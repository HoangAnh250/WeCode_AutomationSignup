import type { BrowserContext } from 'playwright';
import { z } from 'zod';
import type { SecretCipher } from '../core/crypto.js';
import type { ProfileRepository } from './repositories/profile.repository.js';
import type { ProfileLease, StorageState } from './contracts.js';
import { AppError } from '../core/errors.js';
const stateSchema = z.object({
  cookies: z
    .array(
      z
        .object({
          name: z.string(),
          value: z.string(),
          domain: z.string(),
          path: z.string(),
          expires: z.number(),
          httpOnly: z.boolean(),
          secure: z.boolean(),
          sameSite: z.enum(['Strict', 'Lax', 'None']),
          partitionKey: z.string().optional(),
        })
        .passthrough(),
    )
    .max(10000),
  origins: z
    .array(
      z
        .object({
          origin: z.string().url(),
          localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
          indexedDB: z.array(z.unknown()).optional(),
        })
        .passthrough(),
    )
    .max(200),
});
export class StorageStateManager {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly cipher: SecretCipher,
    private readonly maxBytes = 10_000_000,
  ) {}
  validate(value: unknown): StorageState {
    const text = JSON.stringify(value);
    if (text === undefined)
      throw new AppError('INVALID_STORAGE_STATE', 'Browser storage snapshot is missing.', 422);
    if (Buffer.byteLength(text) > this.maxBytes)
      throw new AppError(
        'STORAGE_STATE_TOO_LARGE',
        'Browser storage state exceeds its limit.',
        413,
      );
    const result = stateSchema.safeParse(value);
    if (!result.success)
      throw new AppError('INVALID_STORAGE_STATE', 'Browser storage snapshot is invalid.', 422);
    for (const origin of result.data.origins)
      if (!['http:', 'https:'].includes(new URL(origin.origin).protocol))
        throw new AppError('INVALID_STORAGE_STATE', 'Storage origin must use HTTP(S).', 422);
    return result.data as StorageState;
  }
  assertOwned(lease: ProfileLease) {
    return this.profiles.owned(lease);
  }
  async load(lease: ProfileLease) {
    const profile = await this.profiles.owned(lease);
    if (!profile.stateCipher) return undefined;
    try {
      return this.validate(
        JSON.parse(this.cipher.open(profile.stateCipher, `browser-profile:${lease.id}`)),
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'STORAGE_STATE_CORRUPT',
        'Saved browser state could not be authenticated.',
        409,
      );
    }
  }
  async capture(lease: ProfileLease, context: BrowserContext, browserVersion: string) {
    const state = this.validate(await context.storageState({ indexedDB: true }));
    await this.profiles.saveState(
      lease,
      this.cipher.seal(JSON.stringify(state), `browser-profile:${lease.id}`),
      browserVersion,
    );
    return state;
  }
}
