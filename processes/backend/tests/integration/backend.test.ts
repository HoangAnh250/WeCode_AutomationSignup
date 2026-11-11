import { createEngine } from '../../src/automation/create-engine.js';
import { EmailVerificationCoordinator } from '../../src/automation/EmailVerificationCoordinator.js';
import type { ExecutionContext } from '../../src/queue/executor.js';
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { loadConfig } from '../../src/core/config.js';
import { createContainer, type Container } from '../../src/composition.js';
import { createApp } from '../../src/http/app.js';
import { BullTaskQueue } from '../../src/queue/runtime.js';
import { createTaskProcessor } from '../../src/queue/processor.js';
import { MissingAutomationExecutor, type AutomationExecutor } from '../../src/queue/executor.js';
import { createTaskWorkerForTest } from '../support/worker.js';
import { AppError } from '../../src/core/errors.js';
import type { MailCandidate, MailGateway } from '../../src/infrastructure/imap.gateway.js';
let c: Container, app: ReturnType<typeof createApp>, queue: BullTaskQueue;
let messages: MailCandidate[] = [];
let scannedMailbox: string | undefined;
const token = randomBytes(32).toString('hex');
const authorization = `Bearer ${token}`;
const gateway: MailGateway = {
  test: async () => {},
  scan: async (config) => {
    scannedMailbox = config.mailbox;
    return messages;
  },
};
const enabled = Boolean(process.env.TEST_DATABASE_URL);
describe.skipIf(!enabled)('PostgreSQL + Redis + Express integration', () => {
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL!;
    if (!new URL(url).pathname.endsWith('_test'))
      throw new Error('Integration tests require a dedicated database ending in _test.');
    const config = loadConfig({
      ...process.env,
      DATABASE_URL: url,
      API_TOKEN: token,
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      INSTALLATION_ID: `test-${randomUUID().slice(0, 8)}`,
      LOG_LEVEL: 'error',
    });
    queue = new BullTaskQueue(config.REDIS_URL, config.INSTALLATION_ID);
    c = createContainer(config, {
      queue,
      mail: gateway,
      probe: { check: async () => ({ healthy: true, latencyMs: 42 }) },
    });
    await c.db.$connect();
    app = createApp(c);
    await queue.queue.waitUntilReady();
  });
  beforeEach(async () => {
    messages = [];
    await c.db.$transaction(async (tx) => {
      await tx.outboxEvent.deleteMany();
      await tx.task.updateMany({ data: { currentRunId: null } });
      await tx.session.deleteMany();
      await tx.account.deleteMany();
      await tx.taskRun.deleteMany();
      await tx.task.deleteMany();
      await tx.verificationRequest.deleteMany();
      await tx.emailConfig.deleteMany();
      await tx.proxyHealth.deleteMany();
      await tx.proxy.deleteMany();
      await tx.log.deleteMany();
    });
  });
  afterAll(async () => {
    if (queue) {
      await queue.queue.obliterate({ force: true });
      await queue.close();
    }
    if (c) await c.db.$disconnect();
  });
  async function mailbox() {
    const r = await request(app)
      .post('/api/v1/email-configs')
      .set('Authorization', authorization)
      .send({
        inboxAddress: 'inbox@example.test',
        appPassword: 'test-app-password',
        host: 'imap.example.test',
        port: 993,
      });
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.body)).not.toContain('test-app-password');
    return r.body.id as string;
  }
  async function task() {
    const emailConfigId = await mailbox();
    const r = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', authorization)
      .send({ name: 'Create Account', config: { domain: 'nam.fit' }, emailConfigId });
    expect(r.status).toBe(201);
    return r.body;
  }
  it('enforces authentication, origin isolation and non-leaking errors', async () => {
    expect((await request(app).get('/health/live')).status).toBe(200);
    expect((await request(app).get('/api/v1/accounts')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/v1/accounts')
          .set('Authorization', authorization)
          .set('Origin', 'https://hostile.test')
      ).status,
    ).toBe(403);
    const bad = await request(app)
      .post('/api/v1/email-configs')
      .set('Authorization', authorization)
      .send({ appPassword: 'very-sensitive-value' });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).not.toContain('very-sensitive-value');
    expect(
      (await request(app).get('/health/ready').set('Authorization', authorization)).status,
    ).toBe(200);
  });
  it('implements idempotent task creation with mismatched-key rejection', async () => {
    const input = { name: 'Create Account', config: { domain: 'nam.fit' } };
    const a = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', authorization)
      .set('Idempotency-Key', 'repeatable-key-1')
      .send(input);
    const b = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', authorization)
      .set('Idempotency-Key', 'repeatable-key-1')
      .send(input);
    expect(b.body.id).toBe(a.body.id);
    expect(
      (
        await request(app)
          .post('/api/v1/tasks')
          .set('Authorization', authorization)
          .set('Idempotency-Key', 'repeatable-key-1')
          .send({ ...input, name: 'Different' })
      ).status,
    ).toBe(409);
  });
  it('serializes concurrent starts, persists an outbox, and acknowledges queued pause', async () => {
    const t = await task();
    const [a, b] = await Promise.all([
      request(app)
        .post(`/api/v1/tasks/${t.id}/start`)
        .set('Authorization', authorization)
        .send({ version: 1 }),
      request(app)
        .post(`/api/v1/tasks/${t.id}/start`)
        .set('Authorization', authorization)
        .send({ version: 1 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    const current = await c.tasks.get(t.id);
    expect(current.runs).toHaveLength(1);
    expect(await c.db.outboxEvent.count()).toBe(1);
    const paused = await c.tasks.command(t.id, 'pause', current.version);
    expect(paused.status).toBe('PAUSED');
    const resumed = await c.tasks.command(t.id, 'resume', paused.version);
    expect(resumed.status).toBe('QUEUED');
    expect(resumed.attemptCount).toBe(2);
  });
  it('invalidates a paused checkpoint when execution configuration changes', async () => {
    const t = await task();
    const started = await c.tasks.command(t.id, 'start', 1);
    const paused = await c.tasks.command(t.id, 'pause', started.version);
    const updated = await c.tasks.update(
      t.id,
      {
        name: 'Updated domain',
        config: {
          domain: 'other.test',
          pattern: '[random][digits]',
          count: 1,
          password: { length: 20, uppercase: true, lowercase: true, numbers: true, special: true },
        },
        emailConfigId: t.emailConfigId,
      },
      paused.version,
    );
    expect(updated.status).toBe('DRAFT');
    expect(updated.currentRunId).toBeNull();
    await expect(c.tasks.command(t.id, 'resume', updated.version)).rejects.toThrow(
      'acknowledged paused',
    );
  });
  it('retries only pre-side-effect transient failures and confirms a stored result', async () => {
    const t = await task();
    const started = await c.tasks.command(t.id, 'start', 1);
    let attempts = 0;
    const executor: AutomationExecutor = {
      execute: async (ctx) => {
        if (++attempts === 1)
          throw new AppError('TRANSIENT_DEPENDENCY', 'Temporary dependency outage.', 503, true);
        await ctx.beforeExternalMutation();
        await c.accounts.create({
          email: 'confirmed@nam.fit',
          username: 'confirmed',
          password: 'not-a-live-credential',
          status: 'created',
          taskRunId: ctx.runId,
        });
      },
    };
    const processor = createTaskProcessor(c.db, executor, new AbortController().signal);
    await expect(
      processor({ data: { runId: started.currentRunId! }, attemptsMade: 0, opts: { attempts: 3 } }),
    ).rejects.toThrow('TRANSIENT_DEPENDENCY');
    expect((await c.tasks.get(t.id)).status).toBe('QUEUED');
    await processor({
      data: { runId: started.currentRunId! },
      attemptsMade: 1,
      opts: { attempts: 3 },
    });
    const completed = await c.tasks.get(t.id);
    expect(completed.status).toBe('SUCCEEDED');
    expect(completed.runs[0].outcome).toBe('CREATED');
    await processor({
      data: { runId: started.currentRunId! },
      attemptsMade: 2,
      opts: { attempts: 3 },
    });
    expect(attempts).toBe(2);
    expect(await c.db.account.count()).toBe(1);
  });
  it('stores session payloads encrypted and refuses expired snapshots', async () => {
    const account = await c.accounts.create({
      email: 'session@nam.fit',
      username: 'session',
      password: 'local-secret',
      status: 'created',
    });
    const snapshot = await c.sessions.save(
      account.id,
      { accessToken: 'sensitive-session-token' },
      new Date(Date.now() + 60000).toISOString(),
    );
    const record = await c.db.session.findUniqueOrThrow({ where: { id: snapshot.id } });
    expect(record.payloadCipher).not.toContain('sensitive-session-token');
    const list = await c.sessions.list(account.id);
    expect(JSON.stringify(list)).not.toContain('sensitive-session-token');
    await c.sessions.revoke(snapshot.id);
    expect((await c.sessions.list(account.id))[0].revokedAt).not.toBeNull();
    await expect(
      c.sessions.save(account.id, {}, new Date(Date.now() - 1000).toISOString()),
    ).rejects.toThrow('future');
  });
  it('does not claim account success when the browser adapter is absent', async () => {
    const t = await task();
    const started = await c.tasks.command(t.id, 'start', 1);
    const processor = createTaskProcessor(
      c.db,
      new MissingAutomationExecutor(),
      new AbortController().signal,
    );
    await expect(
      processor({ data: { runId: started.currentRunId! }, attemptsMade: 0, opts: { attempts: 3 } }),
    ).rejects.toThrow('AUTOMATION_NOT_INSTALLED');
    const latest = await c.tasks.get(t.id);
    expect(latest.status).toBe('BLOCKED');
    expect(latest.runs[0].outcome).toBe('NOT_CREATED');
    expect(await c.db.account.count()).toBe(0);
  });
  it('blocks retry after an uncertain external mutation', async () => {
    const t = await task();
    const started = await c.tasks.command(t.id, 'start', 1);
    const executor: AutomationExecutor = {
      execute: async (ctx) => {
        await ctx.beforeExternalMutation();
        throw new AppError('TIMEOUT', 'Transport timed out.', 504, true);
      },
    };
    await expect(
      createTaskProcessor(
        c.db,
        executor,
        new AbortController().signal,
      )({ data: { runId: started.currentRunId! }, attemptsMade: 0, opts: { attempts: 3 } }),
    ).rejects.toThrow();
    const latest = await c.tasks.get(t.id);
    expect(latest.status).toBe('NEEDS_RECONCILIATION');
    expect(latest.runs[0].outcome).toBe('UNKNOWN');
    await expect(c.tasks.command(t.id, 'retry', latest.version)).rejects.toThrow(
      'cannot be retried safely',
    );
  });
  it('honors cooperative running-task pause and preserves checkpoints', async () => {
    const t = await task();
    const started = await c.tasks.command(t.id, 'start', 1);
    const executor: AutomationExecutor = {
      execute: async (ctx) => {
        await ctx.saveCheckpoint({ stage: 'before-otp' });
        const current = await c.tasks.get(ctx.taskId);
        await c.tasks.command(ctx.taskId, 'pause', current.version);
        await ctx.assertCanContinue();
      },
    };
    await createTaskProcessor(
      c.db,
      executor,
      new AbortController().signal,
    )({ data: { runId: started.currentRunId! }, attemptsMade: 0, opts: { attempts: 3 } });
    const latest = await c.tasks.get(t.id);
    expect(latest.status).toBe('PAUSED');
    expect(latest.runs[0].checkpoint).toEqual({ stage: 'before-otp' });
  });
  it('persists account passwords encrypted and exports valid CSV and XLSX', async () => {
    await c.accounts.create({
      email: 'alex123@nam.fit',
      username: 'alex123',
      password: 'private-account-secret',
      status: 'created',
    });
    await c.accounts.create({
      email: 'john888@nam.fit',
      username: '=DANGEROUS()',
      password: 'another-secret',
      status: 'verified',
    });
    const stored = await c.db.account.findUniqueOrThrow({ where: { email: 'alex123@nam.fit' } });
    expect(stored.passwordCipher).not.toContain('private-account-secret');
    const list = await request(app)
      .get('/api/v1/accounts?search=alex&page=1&limit=1')
      .set('Authorization', authorization);
    expect(list.body.total).toBe(1);
    expect(JSON.stringify(list.body)).not.toContain('passwordCipher');
    expect(JSON.stringify(list.body)).not.toContain('private-account-secret');
    const revealed = await request(app)
      .get(`/api/v1/accounts/${stored.id}/password`)
      .set('Authorization', authorization);
    expect(revealed.body.password).toBe('private-account-secret');
    expect(revealed.headers['cache-control']).toBe('no-store');
    const csv = await request(app)
      .get('/api/v1/exports/accounts?format=csv')
      .set('Authorization', authorization);
    expect(csv.text).toContain("'=DANGEROUS()");
    expect(csv.text).not.toContain('private-account-secret');
    const fullCsv = await request(app)
      .get('/api/v1/exports/accounts?format=csv&includePasswords=true&search=alex')
      .set('Authorization', authorization);
    expect(fullCsv.status).toBe(200);
    expect(fullCsv.text).toContain('private-account-secret');
    expect(fullCsv.text).not.toContain('john888@nam.fit');
    expect(fullCsv.text).not.toContain(stored.passwordCipher);
    expect(fullCsv.headers['cache-control']).toBe('no-store');
    const response = await request(app)
      .get('/api/v1/exports/accounts?format=xlsx&search=alex&includePasswords=true')
      .set('Authorization', authorization)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    expect(workbook.getWorksheet('Accounts')?.getCell('A2').value).toBe('alex123@nam.fit');
    expect(workbook.getWorksheet('Accounts')?.getCell('C2').value).toBe('private-account-secret');
    expect(workbook.getWorksheet('Accounts')?.rowCount).toBe(2);
  });
  it('imports proxy formats, preserves secrets, rotates healthy proxies and records usage', async () => {
    const result = await c.proxies.import(
      'proxy-a.test:8080:u:private-proxy-secret\nhttps://proxy-b.test:8443\nproxy-a.test:8080:u:private-proxy-secret',
      'txt',
      false,
    );
    expect('imported' in result && result.imported).toBe(2);
    const list = await request(app).get('/api/v1/proxies').set('Authorization', authorization);
    expect(JSON.stringify(list.body)).not.toContain('private-proxy-secret');
    for (const p of list.body.items) await c.proxies.check(p.id);
    const one = await c.proxies.rotate(),
      two = await c.proxies.rotate();
    expect(one.id).not.toBe(two.id);
    expect((await c.proxies.statistics()).totalAssignments).toBe(2);
    expect(await c.db.proxyHealth.count()).toBe(2);
  });
  it('matches forwarded OTP to exact identity and rejects ambiguity/reuse', async () => {
    const id = await mailbox();
    const v = await c.email.createVerification(id, {
      recipient: 'alex123@nam.fit',
      sender: 'no-reply@weverse.example',
      ttlSeconds: 300,
    });
    messages = [
      {
        uid: '10',
        uidValidity: '1',
        receivedAt: new Date(),
        sender: ['no-reply@weverse.example'],
        recipients: ['alex123@nam.fit'],
        text: 'Verification code 123456.',
      },
    ];
    expect((await c.email.scan(v.id)).status).toBe('detected');
    expect(await c.email.code(v.id)).toBe('123456');
    const wrong = await c.email.createVerification(id, {
      recipient: 'john888@nam.fit',
      sender: 'no-reply@weverse.example',
      ttlSeconds: 300,
    });
    expect((await c.email.scan(wrong.id)).status).toBe('waiting');
    const ambiguous = await c.email.createVerification(id, {
      recipient: 'alex123@nam.fit',
      sender: 'no-reply@weverse.example',
      ttlSeconds: 300,
    });
    messages = [{ ...messages[0], uid: '11', receivedAt: new Date(), text: '123456 and 987654' }];
    expect((await c.email.scan(ambiguous.id)).status).toBe('ambiguous');
    await expect(c.email.code(ambiguous.id)).rejects.toThrow('No unexpired');
  });
  it('uses Redis-backed outbox delivery with an actual BullMQ worker', async () => {
    const t = await task();
    const started = await c.tasks.command(t.id, 'start', 1);
    const runtime = createTaskWorkerForTest(c.db, c.config, new MissingAutomationExecutor());
    try {
      await runtime.worker.waitUntilReady();
      await c.outbox.dispatch();
      await c.outbox.dispatch();
      await expect
        .poll(async () => (await c.tasks.get(t.id)).status, { timeout: 10000 })
        .toBe('BLOCKED');
      const jobs = await queue.queue.getJobs(['failed']);
      expect(jobs.some((j) => j.id === started.currentRunId!)).toBe(true);
      expect(await c.db.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
    } finally {
      await runtime.close();
    }
  });
  it('persists separate account domain and OTP inbox, with safe legacy defaults', async () => {
    const legacyId = await mailbox();
    const legacy = await c.db.emailConfig.findUniqueOrThrow({ where: { id: legacyId } });
    expect(legacy.accountDomain).toBeNull();
    expect(legacy.mailbox).toBe('INBOX');
    const response = await request(app)
      .post('/api/v1/email-configs')
      .set('Authorization', authorization)
      .send({
        inboxAddress: 'alo123@gmail.com',
        accountDomain: 'mytic.website',
        appPassword: 'abcd efgh ijkl mnop',
        host: 'imap.gmail.com',
        port: 1993,
        mailbox: 'Verification',
      });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      inboxAddress: 'alo123@gmail.com',
      accountDomain: 'mytic.website',
      mailbox: 'Verification',
    });
    expect(JSON.stringify(response.body)).not.toContain('abcd');
    const record = await c.db.emailConfig.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(record.appPasswordCipher).not.toContain('abcdefgh');
    await c.email.test(record.id);
    const update = await request(app)
      .patch(`/api/v1/email-configs/${record.id}`)
      .set('Authorization', authorization)
      .send({ version: record.version, accountDomain: 'mytic.website' });
    expect(update.status).toBe(200);
    expect(update.body.port).toBe(1993);
    expect(update.body.status).toBe('connected');
    expect(update.body.mailbox).toBe('Verification');
    await expect(
      c.email.createVerification(record.id, {
        recipient: 'alo123@gmail.com',
        sender: 'no-reply@example.test',
        ttlSeconds: 300,
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_DOMAIN_MISMATCH' });
    const v = await c.email.createVerification(record.id, {
      recipient: 'alex123@mytic.website',
      sender: 'no-reply@example.test',
      ttlSeconds: 300,
    });
    const current = await c.db.emailConfig.findUniqueOrThrow({ where: { id: record.id } });
    await c.email.update(record.id, { version: current.version, mailbox: 'OtherFolder' });
    messages = [
      {
        uid: '42',
        uidValidity: '7',
        receivedAt: new Date(),
        sender: ['no-reply@example.test'],
        recipients: ['alex123@mytic.website', 'alo123@gmail.com'],
        text: 'OTP 123456',
      },
    ];
    expect((await c.email.scan(v.id)).status).toBe('detected');
    expect(scannedMailbox).toBe('Verification');
    const list = await request(app)
      .get(`/api/v1/email-configs/${record.id}/verifications`)
      .set('Authorization', authorization);
    expect(list.status).toBe(200);
    expect(list.body[0]).toMatchObject({ recipient: 'alex123@mytic.website', status: 'detected' });
    expect(JSON.stringify(list.body)).not.toMatch(/123456|codeCipher|appPassword/);
  });
  it('creates tracking before OTP dispatch and waits for the generated account recipient', async () => {
    const id = await mailbox();
    let checkpoint: Record<string, unknown> = {};
    const controller = new AbortController();
    const execution: ExecutionContext = {
      runId: randomUUID(),
      taskId: randomUUID(),
      leaseToken: randomUUID(),
      config: { domain: 'mytic.website' },
      checkpoint: null,
      signal: controller.signal,
      assertCanContinue: async () => {},
      saveCheckpoint: async (value) => {
        checkpoint = value;
      },
      beforeExternalMutation: async () => {
        throw new Error('OTP dispatch is not the final account-creation commit');
      },
    };
    const coordinator = new EmailVerificationCoordinator(c.email, 5);
    let dispatched = '';
    const code = await coordinator.bind(execution, id, 'mytic.website')(
      'alex123@mytic.website',
      'no-reply@example.test',
      async (recipient) => {
        dispatched = recipient;
        const requests = await c.email.verifications(id);
        expect(requests).toHaveLength(1);
        expect(requests[0].recipient).toBe(recipient);
        messages = [
          {
            uid: '99',
            uidValidity: '8',
            receivedAt: new Date(),
            sender: ['no-reply@example.test'],
            recipients: [recipient, 'alo123@gmail.com'],
            text: 'Verification code 654321.',
          },
        ];
      },
    );
    expect(dispatched).toBe('alex123@mytic.website');
    expect(code).toBe('654321');
    expect(JSON.stringify(checkpoint)).not.toContain('654321');
    const resumed = { ...execution, checkpoint };
    const replay = await coordinator.bind(resumed, id, 'mytic.website')(
      'alex123@mytic.website',
      'no-reply@example.test',
      async () => {
        throw new Error('Do not resend the prior OTP request');
      },
    );
    expect(replay).toBe(code);
  });
  it('exposes blocked-run diagnostics, ordered worker logs and a safe manual retry', async () => {
    const t = await task();
    const started = await c.tasks.command(t.id, 'start', 1);
    const engine = createEngine(c.config, c.db, c.logger);
    try {
      await expect(
        createTaskProcessor(
          c.db,
          engine.executor,
          new AbortController().signal,
        )({ data: { runId: started.currentRunId! }, attemptsMade: 0, opts: { attempts: 3 } }),
      ).rejects.toThrow('WORKFLOW_NOT_CONFIGURED');
    } finally {
      await engine.close();
    }
    const list = await request(app).get('/api/v1/tasks').set('Authorization', authorization);
    const blocked = list.body.items.find((row: { id: string }) => row.id === t.id);
    expect(blocked.status).toBe('BLOCKED');
    expect(blocked.currentRun).toMatchObject({
      errorCode: 'WORKFLOW_NOT_CONFIGURED',
      retryable: true,
      outcome: 'NOT_CREATED',
    });
    expect(blocked.currentRun).not.toHaveProperty('leaseToken');
    const logs = await c.db.log.findMany({ where: { entityId: t.id }, orderBy: { id: 'asc' } });
    const events = logs.map((l) => l.event);
    expect(events).toContain('task.worker_started');
    expect(events).toContain('task.workflow_check');
    expect(events.indexOf('task.worker_started')).toBeLessThan(
      events.indexOf('task.workflow_check'),
    );
    expect(events.indexOf('task.workflow_check')).toBeLessThan(
      events.indexOf('task.execution_stopped'),
    );
    expect(events).not.toContain('task.browser_opened');
    const stop = logs.find((l) => l.event === 'task.execution_stopped');
    expect(stop?.level).toBe('error');
    expect(stop?.metadata).toMatchObject({ code: 'WORKFLOW_NOT_CONFIGURED', status: 'BLOCKED' });
    const retried = await request(app)
      .post(`/api/v1/tasks/${t.id}/retry`)
      .set('Authorization', authorization)
      .send({ version: blocked.version });
    expect(retried.status).toBe(202);
    expect(retried.body.currentRunId).not.toBe(started.currentRunId);
    expect(retried.body.status).toBe('QUEUED');
  });
  it('creates an atomic ten-row batch with idempotent retries and one account per row', async () => {
    const emailConfigId = await mailbox();
    const batchId = randomUUID();
    const input = {
      batchId,
      size: 10,
      task: {
        name: 'Batch fixture',
        emailConfigId,
        config: { domain: 'nam.fit', count: 1, browser: { proxyMode: 'direct' } },
      },
    };
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app).post('/api/v1/tasks/batch').set('Authorization', authorization).send(input),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const rows = await c.db.task.findMany({ orderBy: { name: 'asc' } });
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => (row.config as any).count === 1 && row.status === 'DRAFT')).toBe(
      true,
    );
    expect(rows.map((row) => (row.config as any).batch.index)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(
      (
        await request(app)
          .post('/api/v1/tasks/batch')
          .set('Authorization', authorization)
          .send({ ...input, size: 11 })
      ).status,
    ).toBe(409);
    expect(await c.db.task.count()).toBe(10);
    const first = rows[0];
    const edited = await c.tasks.update(
      first.id,
      { name: 'Edited row', emailConfigId, config: first.config as any },
      first.version,
    );
    expect((edited.config as any).batch.id).toBe(batchId);
  });
  it.each(['OTP_AMBIGUOUS', 'WEVERSE_SELECTOR_CHANGED'])(
    'allows manual retry for an older %s failure only before creation',
    async (errorCode) => {
      const t = await task();
      const started = await c.tasks.command(t.id, 'start', t.version);
      await c.db.taskRun.update({
        where: { id: started.currentRunId! },
        data: {
          status: 'FAILED',
          errorCode,
          retryable: false,
          outcome: 'NOT_CREATED',
        },
      });
      await c.db.task.update({ where: { id: t.id }, data: { status: 'FAILED' } });
      const retried = await c.tasks.command(t.id, 'retry', started.version);
      expect(retried.currentRunId).not.toBe(started.currentRunId);
      await c.db.taskRun.update({
        where: { id: retried.currentRunId! },
        data: {
          status: 'NEEDS_RECONCILIATION',
          errorCode,
          retryable: true,
          outcome: 'UNKNOWN',
        },
      });
      await c.db.task.update({ where: { id: t.id }, data: { status: 'NEEDS_RECONCILIATION' } });
      await expect(c.tasks.command(t.id, 'retry', retried.version)).rejects.toThrow();
    },
  );
});
