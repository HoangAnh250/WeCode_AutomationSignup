import { describe, it, expect, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AesSecretCipher } from '../../src/core/crypto.js';
import { EmailManager } from '../../src/services/email.service.js';
import { EmailRepository, emailPublic } from '../../src/repositories/email.repository.js';
import { emailConfigSchema } from '../../src/contracts/schemas.js';
import { createApp } from '../../src/http/app.js';
import { createLogger } from '../../src/infrastructure/logger.js';
import type { Database } from '../../src/infrastructure/database.js';
import type { Container } from '../../src/composition.js';

function fixture() {
  let record: any;
  const publicRecord = () =>
    Object.fromEntries(Object.keys(emailPublic).map((key) => [key, record[key]]));
  const db = {
    emailConfig: {
      create: vi.fn(async ({ data }: any) => {
        record = { ...data, version: 1, status: 'unknown' };
        return publicRecord();
      }),
      findUnique: vi.fn(async ({ where }: any) => (record?.id === where.id ? { ...record } : null)),
      findMany: vi.fn(async () => (record ? [publicRecord()] : [])),
      update: vi.fn(async ({ data }: any) => {
        record = {
          ...record,
          ...Object.fromEntries(
            Object.entries(data).filter(([key, value]) => key !== 'version' && value !== undefined),
          ),
          version: record.version + 1,
        };
        return publicRecord();
      }),
    },
    $queryRaw: vi.fn(async () => []),
    $transaction: async (run: (tx: unknown) => unknown) => run(db),
    log: { create: vi.fn(async () => ({})) },
  };
  const database = db as unknown as Database;
  const cipher = new AesSecretCipher(randomBytes(32).toString('base64'));
  const manager = () =>
    new EmailManager(new EmailRepository(database), cipher, {
      test: async () => {},
      scan: async () => [],
    });
  const email = manager();
  const app = createApp({
    config: { API_TOKEN: 'credential-fixture-token' },
    logger: createLogger('silent'),
    email,
  } as unknown as Container);
  return { db, manager, email, app, stored: () => record };
}

describe('saved IMAP credential settings', () => {
  it('reloads encrypted Gmail credentials across service instances and retains them during metadata edits', async () => {
    const f = fixture();
    const saved = await f.email.create(
      emailConfigSchema.parse({
        inboxAddress: 'fixture@gmail.com',
        host: 'imap.gmail.com',
        accountDomain: 'example.test',
        appPassword: 'abcd efgh ijkl mnop',
      }),
    );
    expect(f.stored().appPasswordCipher).not.toContain('abcdefgh');
    expect(await f.manager().appPassword(saved.id)).toBe('abcdefghijklmnop');
    expect(JSON.stringify(await f.email.list())).not.toContain('appPassword');
    const cipher = f.stored().appPasswordCipher;
    await f.email.update(saved.id, { version: 1, accountDomain: 'other.example' });
    expect(f.stored().appPasswordCipher).toBe(cipher);
    expect(await f.manager().appPassword(saved.id)).toBe('abcdefghijklmnop');
    await f.email.update(saved.id, { version: 2, appPassword: 'qrst uvwx yzab cdef' });
    expect(await f.manager().appPassword(saved.id)).toBe('qrstuvwxyzabcdef');
    expect(JSON.stringify(f.db.log.create.mock.calls)).not.toContain('qrst');
  });
  it('exposes the secret only through the authenticated no-store endpoint and rejects invalid/missing records', async () => {
    const f = fixture();
    const saved = await f.email.create(
      emailConfigSchema.parse({
        inboxAddress: 'fixture@gmail.com',
        host: 'imap.gmail.com',
        appPassword: 'abcd efgh ijkl mnop',
      }),
    );
    const path = `/api/v1/email-configs/${saved.id}/app-password`;
    expect((await request(f.app).get(path)).status).toBe(401);
    expect(
      (
        await request(f.app)
          .get(path)
          .set('Authorization', 'Bearer credential-fixture-token')
          .set('Origin', 'http://localhost')
      ).status,
    ).toBe(403);
    const response = await request(f.app)
      .get(path)
      .set('Authorization', 'Bearer credential-fixture-token');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ appPassword: 'abcdefghijklmnop' });
    expect(
      (
        await request(f.app)
          .get(`/api/v1/email-configs/${randomUUID()}/app-password`)
          .set('Authorization', 'Bearer credential-fixture-token')
      ).status,
    ).toBe(404);
    expect(
      (
        await request(f.app)
          .get('/api/v1/email-configs/invalid/app-password')
          .set('Authorization', 'Bearer credential-fixture-token')
      ).status,
    ).toBe(422);
    const list = await request(f.app)
      .get('/api/v1/email-configs')
      .set('Authorization', 'Bearer credential-fixture-token');
    expect(JSON.stringify(list.body)).not.toContain('appPassword');
  });
});
