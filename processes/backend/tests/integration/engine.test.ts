/// <reference lib="dom" />
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import request from 'supertest';
import { AppError } from '../../src/core/errors.js';
import { AesSecretCipher } from '../../src/core/crypto.js';
import { json } from '../../src/core/json.js';
import { loadConfig, type Config } from '../../src/core/config.js';
import { createEngine } from '../../src/automation/create-engine.js';
import { WorkflowRegistry } from '../../src/automation/WorkflowRegistry.js';
import type { BrowserWorkflow, BrowserWorkflowContext } from '../../src/automation/contracts.js';
import { createDatabase } from '../../src/infrastructure/database.js';
import { createLogger } from '../../src/infrastructure/logger.js';
import { createTaskProcessor } from '../../src/queue/processor.js';
import { executionContext } from '../../src/queue/executor.js';
import { BullTaskQueue } from '../../src/queue/runtime.js';
import { startTaskWorker } from '../../src/queue/workers.js';
import { createContainer } from '../../src/composition.js';
import { createApp } from '../../src/http/app.js';
const enabled = Boolean(process.env.TEST_ENGINE_DATABASE_URL);
describe.skipIf(!enabled)('Playwright + PostgreSQL + BullMQ engine', () => {
  let config: Config,
    engine: ReturnType<typeof createEngine>,
    db: ReturnType<typeof createDatabase>,
    root: string,
    server: Server,
    url: string;
  let submitted = 0;
  let driver: BrowserWorkflow['execute'];
  const workflow: BrowserWorkflow = { key: 'create-account', execute: (ctx) => driver(ctx) };
  const signal = () => new AbortController().signal;
  beforeAll(async () => {
    const database = process.env.TEST_ENGINE_DATABASE_URL!;
    if (!new URL(database).pathname.endsWith('_engine_test'))
      throw new Error('Engine tests require a dedicated _engine_test database.');
    root = await mkdtemp(join(tmpdir(), 'wecode-engine-test-'));
    config = loadConfig({
      ...process.env,
      DATABASE_URL: database,
      API_TOKEN: randomBytes(32).toString('hex'),
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      INSTALLATION_ID: `engine-${randomUUID().slice(0, 8)}`,
      LOG_LEVEL: 'error',
      BROWSER_CHANNEL: process.env.TEST_BROWSER_CHANNEL ?? 'chromium',
      BROWSER_POOL_SIZE: '2',
      BROWSER_ACQUIRE_TIMEOUT_MS: '500',
      BROWSER_DATA_DIR: root,
    });
    db = createDatabase(database);
    await db.$connect();
    engine = createEngine(
      config,
      db,
      createLogger('error'),
      new WorkflowRegistry().register(workflow),
      { probe: { check: async () => ({ healthy: true, latencyMs: 1 }) } },
    );
    server = createServer((req, res) => {
      if (req.method === 'POST') {
        submitted++;
        res.setHeader('Set-Cookie', 'fixtureSession=authenticated; Path=/; HttpOnly; SameSite=Lax');
        res.end('<h1>Account created</h1>');
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<form method="post"><label>Email<input name="email" type="email"></label><button>Create Account</button></form>',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }, 30000);
  beforeEach(async () => {
    submitted = 0;
    await db.$transaction(async (tx) => {
      await tx.outboxEvent.deleteMany();
      await tx.task.updateMany({ data: { currentRunId: null } });
      await tx.session.deleteMany();
      await tx.account.deleteMany();
      await tx.proxyAssignment.deleteMany();
      await tx.browserProfile.deleteMany();
      await tx.taskRun.deleteMany();
      await tx.task.deleteMany();
      await tx.proxyHealth.deleteMany();
      await tx.proxy.deleteMany();
      await tx.log.deleteMany();
    });
    driver = async ({ execution, page }) => {
      await page.goto(url);
      const email = `fixture-${execution.runId}@example.test`;
      await page.getByLabel('Email').fill(email);
      await execution.saveCheckpoint({ stage: 'ready-to-submit' });
      await execution.beforeExternalMutation();
      await page.getByRole('button', { name: 'Create Account' }).click();
      await page.getByRole('heading', { name: 'Account created' }).waitFor();
      return {
        account: {
          email,
          username: 'fixture-user',
          password: 'Fixture-only-Password!123',
          status: 'verified',
        },
      };
    };
  });
  afterAll(async () => {
    if (engine) await engine.close();
    if (db) await db.$disconnect();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (root) {
      const target = resolve(root),
        base = resolve(tmpdir());
      if (!target.startsWith(base + sep) || !target.includes('wecode-engine-test-'))
        throw new Error('Refusing unexpected test cleanup path');
      await rm(target, { recursive: true, force: true });
    }
  });
  async function run(
    status: 'RUNNING' | 'QUEUED' = 'RUNNING',
    taskConfig: Record<string, unknown> = { domain: 'example.test' },
  ) {
    const task = await db.task.create({
      data: { name: 'Engine fixture', config: json(taskConfig), status, desiredState: 'running' },
    });
    const token = randomUUID();
    const record = await db.taskRun.create({
      data: {
        taskId: task.id,
        attempt: 1,
        status,
        leaseToken: status === 'RUNNING' ? token : null,
      },
    });
    await db.task.update({ where: { id: task.id }, data: { currentRunId: record.id } });
    return {
      task,
      record,
      owner: { runId: record.id, token },
      execution: executionContext(db, record.id, task.id, token, taskConfig, null, signal()),
    };
  }
  it('launches multiple Chromium instances and isolates browser contexts', async () => {
    const a = await engine.browsers.acquire({ mode: 'isolated', signal: signal() });
    const b = await engine.browsers.acquire({ mode: 'isolated', signal: signal() });
    try {
      expect(a.id).not.toBe(b.id);
      expect(engine.browsers.status.processes).toBe(2);
      await a.context.addCookies([{ name: 'private', value: 'one', url }]);
      expect(await b.context.cookies(url)).toHaveLength(0);
      await expect(
        engine.browsers.acquire({ mode: 'isolated', signal: signal() }),
      ).rejects.toMatchObject({ code: 'BROWSER_POOL_TIMEOUT' });
    } finally {
      await a.close();
      await b.close();
    }
    const clean = await engine.browsers.acquire({ mode: 'isolated', signal: signal() });
    expect(await clean.context.cookies(url)).toHaveLength(0);
    await clean.close();
    expect(engine.browsers.status.active).toBe(0);
  });
  it('fences profile ownership and does not steal an expired live profile', async () => {
    const a = await run(),
      b = await run();
    const profile = await engine.profiles.create('exclusive');
    const results = await Promise.allSettled([
      engine.profiles.acquire(a.owner, profile.id, a.task.id),
      engine.profiles.acquire(b.owner, profile.id, b.task.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lease = (
      results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
        Awaited<ReturnType<typeof engine.profiles.acquire>>
      >
    ).value;
    await db.browserProfile.update({
      where: { id: lease.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    await expect(engine.profiles.repository.owned(lease)).rejects.toMatchObject({
      code: 'PROFILE_LEASE_LOST',
    });
    await expect(engine.profiles.acquire(a.owner, profile.id, a.task.id)).rejects.toMatchObject({
      code: 'PROFILE_BUSY',
    });
    await engine.profiles.release(lease, true);
    expect((await db.browserProfile.findUniqueOrThrow({ where: { id: lease.id } })).state).toBe(
      'quarantined',
    );
  });
  it('persists encrypted cookies, local storage and IndexedDB across isolated contexts', async () => {
    const a = await run();
    const lease = await engine.profiles.acquire(a.owner, undefined, a.task.id);
    const browser = await engine.browsers.acquire({ mode: 'isolated', signal: signal() });
    await browser.page.goto(url);
    await browser.page.evaluate(async () => {
      localStorage.setItem('fixture-token', 'sensitive-local');
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('fixture', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('tokens');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const tx = database.transaction('tokens', 'readwrite');
          tx.objectStore('tokens').put('indexed-secret', 'auth');
          tx.oncomplete = () => {
            database.close();
            resolve();
          };
        };
      });
    });
    await browser.context.addCookies([{ name: 'auth', value: 'cookie-secret', url }]);
    await engine.storage.capture(lease, browser.context, browser.version);
    await browser.close();
    const stored = await db.browserProfile.findUniqueOrThrow({ where: { id: lease.id } });
    expect(stored.stateCipher).not.toContain('cookie-secret');
    expect(stored.stateCipher).not.toContain('sensitive-local');
    const state = await engine.storage.load(lease);
    expect(state?.origins[0]?.indexedDB?.length).toBe(1);
    const restored = await engine.browsers.acquire({ mode: 'isolated', state, signal: signal() });
    await restored.page.goto(url);
    expect(await restored.page.evaluate(() => localStorage.getItem('fixture-token'))).toBe(
      'sensitive-local',
    );
    expect((await restored.context.cookies(url))[0]?.value).toBe('cookie-secret');
    expect(
      await restored.page.evaluate(
        () =>
          new Promise((resolve) => {
            const open = indexedDB.open('fixture');
            open.onsuccess = () => {
              const db = open.result;
              const get = db.transaction('tokens').objectStore('tokens').get('auth');
              get.onsuccess = () => {
                db.close();
                resolve(get.result);
              };
            };
          }),
      ),
    ).toBe('indexed-secret');
    await restored.close();
    await engine.profiles.release(lease);
  });
  it('reopens an exclusive persistent profile without losing browser state', async () => {
    const a = await run();
    const lease = await engine.profiles.acquire(a.owner, undefined, a.task.id, 'persistent');
    const directory = await engine.profiles.directory(lease);
    const first = await engine.browsers.acquire({
      mode: 'persistent',
      directory,
      signal: signal(),
    });
    await first.page.goto(url);
    await first.page.evaluate(() => localStorage.setItem('persistent', 'yes'));
    await first.context.addCookies([
      { name: 'persistent', value: 'yes', url, expires: Math.floor(Date.now() / 1000) + 3600 },
    ]);
    await first.close();
    const second = await engine.browsers.acquire({
      mode: 'persistent',
      directory,
      signal: signal(),
    });
    await second.page.goto(url);
    expect(await second.page.evaluate(() => localStorage.getItem('persistent'))).toBe('yes');
    expect((await second.context.cookies(url)).some((c) => c.name === 'persistent')).toBe(true);
    await second.close();
    await engine.profiles.release(lease);
  });
  it('runs the complete local form workflow and saves an encrypted account plus session', async () => {
    const a = await run('QUEUED');
    const processor = createTaskProcessor(db, engine.executor, signal());
    await processor({ data: { runId: a.record.id }, attemptsMade: 0, opts: { attempts: 3 } });
    expect(submitted).toBe(1);
    const record = await db.taskRun.findUniqueOrThrow({ where: { id: a.record.id } });
    expect(record).toMatchObject({ status: 'SUCCEEDED', outcome: 'CREATED' });
    const account = await db.account.findFirstOrThrow({ where: { taskRunId: record.id } });
    expect(account.passwordCipher).not.toContain('Fixture-only');
    const session = await db.session.findFirstOrThrow({ where: { accountId: account.id } });
    expect(session.payloadCipher).not.toContain('authenticated');
    expect(session.profileId).toBeTruthy();
    expect(engine.browsers.status.active).toBe(0);
  });
  it('never persists a claimed result without the external mutation fence', async () => {
    const a = await run();
    driver = async () => ({
      account: {
        email: 'unfenced@example.test',
        username: 'fixture',
        password: 'Fixture-only-password',
        status: 'created',
      },
    });
    await expect(engine.executor.execute(a.execution)).rejects.toThrow();
    expect(await db.account.count()).toBe(0);
    expect(engine.browsers.status.active).toBe(0);
  });
  it('blocks absent adapters and rejects ambiguous batch execution', async () => {
    const a = await run();
    const missing = createEngine(config, db, createLogger('error'));
    try {
      await expect(missing.executor.execute(a.execution)).rejects.toMatchObject({
        code: 'WORKFLOW_NOT_CONFIGURED',
      });
      expect(missing.browsers.status.processes).toBe(0);
    } finally {
      await missing.close();
    }
    const batch = await run('RUNNING', { domain: 'example.test', count: 2 });
    await expect(engine.executor.execute(batch.execution)).rejects.toMatchObject({
      code: 'BATCH_REQUIRES_CHILD_TASKS',
    });
  });
  it('limits proxy capacity across workers and refuses unsafe rotation', async () => {
    const a = await run(),
      b = await run();
    const p = await db.proxy.create({
      data: {
        host: '127.0.0.1',
        port: 3128,
        protocol: 'http',
        fingerprint: randomUUID(),
        status: 'healthy',
      },
    });
    const leases = await Promise.allSettled([
      engine.assignments.acquire(a.owner, p.id),
      engine.assignments.acquire(b.owner, p.id),
    ]);
    expect(leases.filter((l) => l.status === 'fulfilled')).toHaveLength(1);
    const lease = (
      leases.find((l) => l.status === 'fulfilled') as PromiseFulfilledResult<
        Awaited<ReturnType<typeof engine.assignments.acquire>>
      >
    ).value;
    await expect(
      engine.rotation.rotateBetweenExecutions(lease.owner, lease, {
        browserClosed: true,
        outcome: 'UNKNOWN',
        sticky: false,
      }),
    ).rejects.toMatchObject({ code: 'UNSAFE_PROXY_ROTATION' });
    await db.proxyAssignment.update({
      where: { id: lease.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    await expect(engine.assignments.acquire(b.owner, p.id)).rejects.toMatchObject({
      code: 'NO_PROXY_CAPACITY',
    });
    await engine.assignments.release(lease);
    const next = await engine.assignments.acquire(b.owner, p.id);
    await engine.assignments.release(next);
  });
  it('health-checks unknown proxies before balanced assignment and checks the leased endpoint again', async () => {
    const pool = await Promise.all(
      [3201, 3202, 3203].map((port) =>
        db.proxy.create({
          data: { host: '127.0.0.1', port, protocol: 'http', fingerprint: randomUUID() },
        }),
      ),
    );
    const probe = {
      check: vi.fn(async (proxy: { port: number }) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          healthy: proxy.port !== 3203,
          latencyMs: 1,
          ...(proxy.port === 3203 ? { errorCode: 'PROXY_CONNECTION_FAILED' } : {}),
        };
      }),
    };
    const prepared = createEngine(
      config,
      db,
      createLogger('error'),
      new WorkflowRegistry().register(workflow),
      { probe },
    );
    driver = async ({ execution }) => {
      await execution.beforeExternalMutation();
      return {
        account: {
          email: `prepared-${execution.runId}@example.test`,
          username: 'prepared',
          password: 'Fixture-only!123',
          status: 'verified',
        },
      };
    };
    try {
      const first = await run('RUNNING', {
        domain: 'example.test',
        browser: { proxyMode: 'auto' },
      });
      const second = await run('RUNNING', {
        domain: 'example.test',
        browser: { proxyMode: 'auto' },
      });
      await Promise.all([
        prepared.executor.execute(first.execution),
        prepared.executor.execute(second.execution),
      ]);
      const assigned = await db.task.findMany({
        where: { id: { in: [first.task.id, second.task.id] } },
        select: { config: true },
      });
      const ids = assigned.map((task) => (task.config as any).browser.assignedProxyId);
      expect(new Set(ids).size).toBe(2);
      expect(ids).not.toContain(pool[2].id);
      expect(probe.check.mock.calls.filter(([proxy]) => proxy.port === 3201)).toHaveLength(2);
      expect(probe.check.mock.calls.filter(([proxy]) => proxy.port === 3202)).toHaveLength(2);
      expect(probe.check.mock.calls.filter(([proxy]) => proxy.port === 3203)).toHaveLength(1);
      const events = await db.log.findMany({
        where: { entityId: first.task.id },
        orderBy: { createdAt: 'asc' },
        select: { event: true },
      });
      const names = events.map((event) => event.event);
      expect(names.indexOf('task.proxy_pool_checking')).toBeLessThan(
        names.indexOf('task.proxy_assigned'),
      );
      expect(names.indexOf('task.proxy_ready')).toBeLessThan(names.indexOf('task.browser_opened'));
      expect(await db.account.count()).toBe(2);
    } finally {
      await prepared.close();
    }
  });
  it('stops before opening a browser if a rotated proxy fails its fresh leased check', async () => {
    await db.proxy.create({
      data: { host: '127.0.0.1', port: 3210, protocol: 'http', fingerprint: randomUUID() },
    });
    let calls = 0;
    const probe = {
      check: async () => ({
        healthy: ++calls === 1,
        latencyMs: 1,
        errorCode: calls > 1 ? 'PROXY_CONNECTION_FAILED' : undefined,
      }),
    };
    const prepared = createEngine(
      config,
      db,
      createLogger('error'),
      new WorkflowRegistry().register(workflow),
      { probe },
    );
    try {
      const item = await run('RUNNING', { domain: 'example.test', browser: { proxyMode: 'auto' } });
      await expect(prepared.executor.execute(item.execution)).rejects.toMatchObject({
        code: 'PROXY_HEALTH_CHECK_FAILED',
        retryable: true,
      });
      expect(calls).toBe(2);
      expect(prepared.browsers.status.processes).toBe(0);
      expect(await db.account.count()).toBe(0);
      expect((await db.taskRun.findUniqueOrThrow({ where: { id: item.record.id } })).outcome).toBe(
        'NOT_CREATED',
      );
      expect(await db.proxyAssignment.count({ where: { releasedAt: null } })).toBe(0);
    } finally {
      await prepared.close();
    }
  });
  it.each([false, true])(
    'handles a stale automatic reservation without changing saved identities (saved=%s)',
    async (saved) => {
      const old = await db.proxy.create({
        data: {
          host: '127.0.0.1',
          port: 3230,
          protocol: 'http',
          fingerprint: randomUUID(),
          status: 'healthy',
        },
      });
      const ready = await db.proxy.create({
        data: { host: '127.0.0.1', port: 3231, protocol: 'http', fingerprint: randomUUID() },
      });
      const item = await run('RUNNING', {
        domain: 'example.test',
        browser: { proxyMode: 'auto', assignedProxyId: old.id },
      });
      if (saved)
        await db.browserProfile.create({
          data: {
            installationId: config.INSTALLATION_ID,
            name: `task-${item.task.id}`,
            assignedProxyId: old.id,
            stateVersion: 1,
            stateCipher: 'fixture-not-read',
          },
        });
      const prepared = createEngine(
        config,
        db,
        createLogger('error'),
        new WorkflowRegistry().register(workflow),
        {
          probe: { check: async (proxy) => ({ healthy: proxy.port === 3231, latencyMs: 1 }) },
        },
      );
      driver = async ({ execution }) => {
        await execution.beforeExternalMutation();
        return {
          account: {
            email: `reassigned-${execution.runId}@example.test`,
            username: 'reassigned',
            password: 'Fixture-only!123',
            status: 'verified',
          },
        };
      };
      try {
        if (saved) {
          await expect(prepared.executor.execute(item.execution)).rejects.toMatchObject({
            code: 'NO_PROXY_CAPACITY',
          });
          expect(prepared.browsers.status.processes).toBe(0);
        } else await prepared.executor.execute(item.execution);
        const task = await db.task.findUniqueOrThrow({ where: { id: item.task.id } });
        expect((task.config as any).browser.assignedProxyId).toBe(saved ? old.id : ready.id);
        expect(await db.account.count()).toBe(saved ? 0 : 1);
      } finally {
        await prepared.close();
      }
    },
  );
  it('rechecks old Healthy snapshots at execution time instead of trusting queued-time health', async () => {
    const proxy = await db.proxy.create({
      data: {
        host: '127.0.0.1',
        port: 3220,
        protocol: 'http',
        fingerprint: randomUUID(),
        status: 'healthy',
      },
    });
    await db.proxyHealth.create({
      data: { proxyId: proxy.id, healthy: true, checkedAt: new Date(Date.now() - 121000) },
    });
    const probe = {
      check: vi.fn(async () => ({
        healthy: false,
        latencyMs: null,
        errorCode: 'PROXY_CONNECTION_FAILED',
      })),
    };
    const prepared = createEngine(
      config,
      db,
      createLogger('error'),
      new WorkflowRegistry().register(workflow),
      { probe },
    );
    try {
      const item = await run('RUNNING', { domain: 'example.test', browser: { proxyMode: 'auto' } });
      await expect(prepared.executor.execute(item.execution)).rejects.toMatchObject({
        code: 'NO_HEALTHY_PROXY',
        retryable: true,
      });
      expect(probe.check).toHaveBeenCalledTimes(1);
      expect(prepared.browsers.status.processes).toBe(0);
      expect(await db.proxyAssignment.count()).toBe(0);
      expect(await db.account.count()).toBe(0);
    } finally {
      await prepared.close();
    }
  });
  it('waits for an automatically assigned proxy instead of switching IP or failing immediately', async () => {
    const proxy = await db.proxy.create({
      data: {
        host: '127.0.0.1',
        port: 3128,
        protocol: 'http',
        fingerprint: randomUUID(),
        status: 'healthy',
      },
    });
    const first = await run();
    const held = await engine.assignments.acquire(first.owner, proxy.id);
    const second = await run('RUNNING', {
      domain: 'example.test',
      browser: { proxyMode: 'auto', assignedProxyId: proxy.id },
    });
    driver = async ({ execution }) => {
      await execution.beforeExternalMutation();
      return {
        account: {
          email: `wait-${execution.runId}@example.test`,
          username: 'waiting',
          password: 'Fixture-Only!123',
          status: 'verified',
        },
      };
    };
    const executing = engine.executor.execute(second.execution);
    try {
      await vi.waitFor(async () =>
        expect(
          await db.log.count({ where: { entityId: second.task.id, event: 'task.proxy_waiting' } }),
        ).toBe(1),
      );
      expect(await db.account.count()).toBe(0);
      await engine.assignments.release(held);
      await executing;
      expect((await db.account.findFirstOrThrow()).proxyUsed).toBe('http://127.0.0.1:3128');
      expect(await db.proxyAssignment.count({ where: { proxyId: proxy.id } })).toBe(2);
    } finally {
      await engine.assignments.release(held);
    }
  });
  it('rotates to another healthy proxy on a safe pre-commit retry', async () => {
    const a = await run();
    const p = await db.proxy.create({
      data: {
        host: '127.0.0.1',
        port: 3128,
        protocol: 'http',
        fingerprint: randomUUID(),
        status: 'healthy',
      },
    });
    const q = await db.proxy.create({
      data: {
        host: '127.0.0.1',
        port: 3129,
        protocol: 'http',
        fingerprint: randomUUID(),
        status: 'healthy',
      },
    });
    const lease = await engine.assignments.acquire(a.owner, p.id);
    await engine.assignments.release(lease, 'failed-before-commit');
    const choice = await engine.rotation.preferredForRetry(a.record.id, undefined, true, 'auto');
    const next = await engine.rotation.next(a.owner, { mode: 'auto', ...choice });
    expect(next?.proxy.id).toBe(q.id);
    await engine.assignments.release(next!);
    await db.taskRun.update({ where: { id: a.record.id }, data: { outcome: 'UNKNOWN' } });
    await expect(
      engine.rotation.preferredForRetry(a.record.id, undefined, true, 'auto'),
    ).rejects.toMatchObject({ code: 'UNSAFE_PROXY_ROTATION' });
  });
  it('pauses an active Playwright wait and releases all browser resources', async () => {
    const a = await run('QUEUED');
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    driver = async ({ page }) => {
      await page.goto(url);
      entered();
      await page.getByText('never exists').waitFor({ timeout: 15000 });
      throw new Error('unreachable');
    };
    const work = createTaskProcessor(
      db,
      engine.executor,
      signal(),
    )({ data: { runId: a.record.id }, attemptsMade: 0, opts: { attempts: 3 } });
    await ready;
    await db.task.update({ where: { id: a.task.id }, data: { desiredState: 'paused' } });
    await expect(work).resolves.toMatchObject({ paused: true });
    expect((await db.taskRun.findUniqueOrThrow({ where: { id: a.record.id } })).status).toBe(
      'PAUSED',
    );
    expect((await db.browserProfile.findFirstOrThrow()).stateVersion).toBeGreaterThan(0);
    expect(engine.browsers.status.active).toBe(0);
  });
  it('does not retry an unknown business outcome', async () => {
    const a = await run('QUEUED');
    driver = async ({ execution }) => {
      await execution.beforeExternalMutation();
      throw new Error('Response was lost after submission');
    };
    await expect(
      createTaskProcessor(
        db,
        engine.executor,
        signal(),
      )({ data: { runId: a.record.id }, attemptsMade: 0, opts: { attempts: 3 } }),
    ).rejects.toThrow();
    expect(await db.taskRun.findUnique({ where: { id: a.record.id } })).toMatchObject({
      status: 'NEEDS_RECONCILIATION',
      retryable: false,
      outcome: 'UNKNOWN',
    });
  });
  it('executes a real Redis-backed BullMQ job using the browser engine', async () => {
    const queue = new BullTaskQueue(config.REDIS_URL, config.INSTALLATION_ID);
    const worker = startTaskWorker(db, config, createLogger('error'), engine.executor);
    try {
      await worker.worker.waitUntilReady();
      await queue.queue.waitUntilReady();
      const a = await run('QUEUED');
      await queue.enqueue(a.record.id);
      await expect
        .poll(async () => (await db.taskRun.findUnique({ where: { id: a.record.id } }))?.status, {
          timeout: 15000,
        })
        .toBe('SUCCEEDED');
      expect(submitted).toBe(1);
      expect(await db.session.count()).toBe(1);
    } finally {
      await worker.close();
      await queue.queue.obliterate({ force: true });
      await queue.close();
    }
  });
  it('exposes profile metadata without cookies, credentials or ciphertext', async () => {
    const queue = new BullTaskQueue(config.REDIS_URL, config.INSTALLATION_ID);
    const c = createContainer(config, { db, queue });
    const app = createApp(c);
    try {
      const response = await request(app)
        .post('/api/v1/browser-profiles')
        .set('Authorization', `Bearer ${config.API_TOKEN}`)
        .send({ name: 'desktop-profile', mode: 'persistent' });
      expect(response.status).toBe(201);
      const list = await request(app)
        .get('/api/v1/browser-profiles')
        .set('Authorization', `Bearer ${config.API_TOKEN}`);
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).not.toMatch(/stateCipher|ownerToken|payloadCipher/);
      const removed = await request(app)
        .delete(`/api/v1/browser-profiles/${response.body.id}`)
        .set('Authorization', `Bearer ${config.API_TOKEN}`);
      expect(removed.status).toBe(204);
    } finally {
      await queue.close();
    }
  });
  it('restores session snapshots only while owned, active and unexpired', async () => {
    const a = await run();
    await engine.executor.execute(a.execution);
    const session = await db.session.findFirstOrThrow();
    const b = await run();
    const profile = await engine.profiles.acquire(b.owner, session.profileId!, b.task.id);
    const browser = await engine.browsers.acquire({ mode: 'isolated', signal: signal() });
    expect(await engine.sessions.restore(session.id, profile, browser.context)).toBe(
      session.accountId,
    );
    expect((await browser.context.cookies(url)).some((c) => c.name === 'fixtureSession')).toBe(
      true,
    );
    await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(engine.sessions.load(session.id, profile)).rejects.toMatchObject({
      code: 'SESSION_UNAVAILABLE',
    });
    await db.session.update({
      where: { id: session.id },
      data: { revokedAt: null, expiresAt: new Date(0) },
    });
    await expect(engine.sessions.load(session.id, profile)).rejects.toMatchObject({
      code: 'SESSION_UNAVAILABLE',
    });
    await browser.close();
    await engine.profiles.release(profile);
  });
  it('interrupts active work on worker shutdown without leaking profile leases', async () => {
    const a = await run();
    const controller = new AbortController();
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    driver = async ({ page }) => {
      await page.goto(url);
      entered();
      await page.getByText('never exists').waitFor();
      throw new Error('unreachable');
    };
    const work = engine.executor.execute({ ...a.execution, signal: controller.signal });
    const assertion = expect(work).rejects.toMatchObject({ code: 'WORKER_SHUTDOWN' });
    await ready;
    controller.abort();
    await assertion;
    expect(engine.browsers.status.active).toBe(0);
    expect((await db.browserProfile.findFirstOrThrow()).state).toBe('idle');
    expect(submitted).toBe(0);
  });
  it('enforces a workflow deadline and settles the cancelled Playwright operation', async () => {
    const limited = createEngine(
      { ...config, BROWSER_EXECUTION_TIMEOUT_MS: 1000 },
      db,
      createLogger('error'),
      new WorkflowRegistry().register(workflow),
    );
    const a = await run();
    driver = async ({ page }) => {
      await page.goto(url);
      await page.getByText('never exists').waitFor({ timeout: 15000 });
      throw new Error('unreachable');
    };
    try {
      await expect(limited.executor.execute(a.execution)).rejects.toMatchObject({
        code: 'EXECUTION_TIMEOUT',
      });
      expect(limited.browsers.status.active).toBe(0);
      expect((await db.browserProfile.findFirstOrThrow()).state).toBe('idle');
    } finally {
      await limited.close();
    }
  });
  it('uses BullMQ retry only before the business commit and creates one account', async () => {
    const normal = driver;
    let attempts = 0;
    driver = async (ctx) => {
      attempts++;
      if (attempts === 1)
        throw new AppError('TRANSIENT_FIXTURE', 'Fixture transient failure.', 503, true);
      return normal(ctx);
    };
    const queue = new BullTaskQueue(config.REDIS_URL, config.INSTALLATION_ID);
    const worker = startTaskWorker(db, config, createLogger('error'), engine.executor);
    try {
      await worker.worker.waitUntilReady();
      await queue.queue.waitUntilReady();
      const a = await run('QUEUED');
      await queue.queue.add(
        'create-account',
        { runId: a.record.id },
        { jobId: a.record.id, attempts: 3, backoff: { type: 'exponential', delay: 50 } },
      );
      await expect
        .poll(async () => (await db.taskRun.findUnique({ where: { id: a.record.id } }))?.status, {
          timeout: 15000,
        })
        .toBe('SUCCEEDED');
      expect(
        (await db.taskRun.findUniqueOrThrow({ where: { id: a.record.id } })).errorCode,
      ).toBeNull();
      expect(attempts).toBe(2);
      expect(submitted).toBe(1);
      expect(await db.account.count()).toBe(1);
    } finally {
      await worker.close();
      await queue.queue.obliterate({ force: true });
      await queue.close();
    }
  });
  it('never replays a browser mutation when resuming a confirmed result', async () => {
    const a = await run();
    await engine.executor.execute(a.execution);
    expect(submitted).toBe(1);
    const token = randomUUID();
    const resumed = await db.taskRun.create({
      data: {
        taskId: a.task.id,
        attempt: 2,
        status: 'RUNNING',
        outcome: 'CREATED',
        leaseToken: token,
      },
    });
    await db.task.update({ where: { id: a.task.id }, data: { currentRunId: resumed.id } });
    driver = async () => {
      throw new Error('Browser workflow must not be replayed');
    };
    await engine.executor.execute(
      executionContext(
        db,
        resumed.id,
        a.task.id,
        token,
        { domain: 'example.test' },
        null,
        signal(),
      ),
    );
    expect(submitted).toBe(1);
    expect(await db.account.count()).toBe(1);
  });
  it('uses a new clean automatic profile after success and retains the same profile on retry', async () => {
    const first = await run();
    await engine.executor.execute(first.execution);
    const original = await db.browserProfile.findFirstOrThrow();
    expect(original.stateVersion).toBeGreaterThan(0);
    await db.taskRun.update({ where: { id: first.record.id }, data: { status: 'SUCCEEDED' } });
    const token = randomUUID();
    const next = await db.taskRun.create({
      data: { taskId: first.task.id, attempt: 2, status: 'RUNNING', leaseToken: token },
    });
    await db.task.update({ where: { id: first.task.id }, data: { currentRunId: next.id } });
    const owner = { runId: next.id, token };
    const fresh = await engine.profiles.acquire(owner, undefined, first.task.id);
    expect(fresh.id).not.toBe(original.id);
    expect((await engine.profiles.repository.owned(fresh)).stateVersion).toBe(0);
    expect(await engine.storage.load(fresh)).toBeUndefined();
    await engine.profiles.release(fresh);
    const retried = await engine.profiles.acquire(owner, undefined, first.task.id);
    expect(retried.id).toBe(fresh.id);
    await engine.profiles.release(retried);
    expect(await db.account.count()).toBe(1);
  });
  it('routes Playwright traffic through the assigned authenticated HTTP proxy', async () => {
    const proxyUser = 'fixture-user',
      proxyPass = 'fixture-proxy-password';
    const expected = 'Basic ' + Buffer.from(`${proxyUser}:${proxyPass}`).toString('base64');
    let authenticated = 0;
    const proxyServer = createServer((req, res) => {
      if (req.headers['proxy-authorization'] !== expected) {
        res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="fixture"' });
        res.end();
        return;
      }
      authenticated++;
      res.setHeader('Content-Type', 'text/html');
      res.end('<h1>Proxy fixture</h1>');
    });
    await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
    const id = randomUUID();
    const cipher = new AesSecretCipher(config.ENCRYPTION_KEY);
    const proxy = await db.proxy.create({
      data: {
        id,
        host: '127.0.0.1',
        port: (proxyServer.address() as { port: number }).port,
        protocol: 'http',
        fingerprint: randomUUID(),
        status: 'healthy',
        usernameCipher: cipher.seal(proxyUser, `proxy-user:${id}`),
        passwordCipher: cipher.seal(proxyPass, `proxy-pass:${id}`),
      },
    });
    const a = await run();
    const lease = await engine.assignments.acquire(a.owner, proxy.id);
    let browser: Awaited<ReturnType<typeof engine.browsers.acquire>> | undefined;
    try {
      browser = await engine.browsers.acquire({
        mode: 'isolated',
        proxy: lease.proxy,
        signal: signal(),
      });
      await browser.page.goto('http://engine-fixture.invalid/form');
      await browser.page.getByRole('heading', { name: 'Proxy fixture' }).waitFor();
      expect(authenticated).toBeGreaterThan(0);
    } finally {
      await browser?.close();
      await engine.assignments.release(lease);
      proxyServer.closeAllConnections();
      await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    }
  });
  it('quarantines an unconfirmed cleanup and stops automatic retry', async () => {
    const original = engine.browsers.acquire.bind(engine.browsers);
    const spy = vi.spyOn(engine.browsers, 'acquire').mockImplementation(async (input) => {
      const lease = await original(input);
      const close = lease.close;
      return {
        ...lease,
        close: async () => {
          await close();
          throw new AppError('BROWSER_CLOSE_UNCONFIRMED', 'Injected cleanup failure.', 503, false);
        },
      };
    });
    try {
      const a = await run('QUEUED');
      driver = async () => {
        throw new AppError('TRANSIENT_FIXTURE', 'Fixture transient failure.', 503, true);
      };
      await expect(
        createTaskProcessor(
          db,
          engine.executor,
          signal(),
        )({ data: { runId: a.record.id }, attemptsMade: 0, opts: { attempts: 3 } }),
      ).rejects.toThrow('RESOURCE_QUARANTINED');
      expect(await db.taskRun.findUnique({ where: { id: a.record.id } })).toMatchObject({
        status: 'FAILED',
        retryable: false,
        outcome: 'NOT_CREATED',
        errorCode: 'RESOURCE_QUARANTINED',
      });
      expect((await db.browserProfile.findFirstOrThrow()).state).toBe('quarantined');
    } finally {
      spy.mockRestore();
    }
  });
  it('Local mode never reserves a proxy even when healthy proxies are available', async () => {
    const proxy = await db.proxy.create({
      data: {
        host: '192.0.2.1',
        port: 8080,
        protocol: 'http',
        fingerprint: randomUUID(),
        status: 'healthy',
      },
    });
    const a = await run('RUNNING', {
      domain: 'example.test',
      count: 1,
      browser: { proxyMode: 'direct' },
    });
    await engine.executor.execute(a.execution);
    expect(await db.proxyAssignment.count()).toBe(0);
    expect((await db.proxy.findUniqueOrThrow({ where: { id: proxy.id } })).totalUses).toBe(0);
    expect(
      (await db.account.findFirstOrThrow({ where: { taskRunId: a.record.id } })).proxyUsed,
    ).toBeNull();
  });
  it('rejects a proxy-bound profile for Local instead of silently using that proxy', async () => {
    const proxy = await db.proxy.create({
      data: {
        host: '192.0.2.1',
        port: 8080,
        protocol: 'http',
        fingerprint: randomUUID(),
        status: 'healthy',
      },
    });
    const profile = await engine.profiles.create('Bound profile', 'isolated', proxy.id);
    const a = await run('RUNNING', {
      domain: 'example.test',
      count: 1,
      browser: { proxyMode: 'direct', profileId: profile.id },
    });
    await expect(engine.executor.execute(a.execution)).rejects.toMatchObject({
      code: 'PROFILE_PROXY_CONFLICT',
    });
    expect(await db.proxyAssignment.count()).toBe(0);
  });
});
