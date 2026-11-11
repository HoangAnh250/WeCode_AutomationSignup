/// <reference lib="dom" />
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { WorkerExecutor, type EngineDependencies } from '../../src/automation/WorkerExecutor.js';
import { AccountManager } from '../../src/services/account.service.js';
import { AccountRepository } from '../../src/repositories/account.repository.js';
import type { BrowserProxy } from '../../src/automation/contracts.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { BrowserManager } from '../../src/automation/BrowserManager.js';
import { WeverseAdapter } from '../../src/automation/WeverseAdapter.js';
import { createProductionEngine } from '../../src/automation/production-engine.js';
import { createEngine } from '../../src/automation/create-engine.js';
import { EmailVerificationCoordinator } from '../../src/automation/EmailVerificationCoordinator.js';
import { WorkflowStateRepository } from '../../src/automation/repositories/workflow-state.repository.js';
import { AesSecretCipher } from '../../src/core/crypto.js';
import { createLogger } from '../../src/infrastructure/logger.js';
import { CatchallManager } from '../../src/services/identity.service.js';
import { loadConfig } from '../../src/core/config.js';
import type { Database } from '../../src/infrastructure/database.js';
import type { EmailManager } from '../../src/services/email.service.js';
import type { BrowserWorkflowContext } from '../../src/automation/contracts.js';
import type { ExecutionContext } from '../../src/queue/executor.js';
import type { WeverseState, WeverseStateStore } from '../../src/automation/weverse/state.js';

const config = loadConfig({
  DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/unused',
  REDIS_URL: 'redis://127.0.0.1:1',
  API_TOKEN: 'a'.repeat(32),
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  BROWSER_CHANNEL: process.env.TEST_BROWSER_CHANNEL ?? 'chrome',
  BROWSER_POOL_SIZE: '1',
});
function execution() {
  let outcome = 'NOT_CREATED',
    fences = 0;
  const context: ExecutionContext = {
    taskId: randomUUID(),
    runId: randomUUID(),
    leaseToken: randomUUID(),
    config: { domain: 'example.test' },
    checkpoint: {},
    signal: new AbortController().signal,
    assertCanContinue: async () => {
      if (context.signal.aborted) throw new Error('stopped');
    },
    saveCheckpoint: async (value) => {
      context.checkpoint = { ...(context.checkpoint as object), ...value };
    },
    beforeExternalMutation: async () => {
      if (outcome !== 'NOT_CREATED') throw new Error('duplicate');
      outcome = 'UNKNOWN';
      fences++;
    },
  };
  return { context, outcome: () => outcome, fences: () => fences };
}
class MemoryStore implements WeverseStateStore {
  value?: WeverseState;
  async read() {
    return this.value && structuredClone(this.value);
  }
  async mutate(
    _execution: ExecutionContext,
    update: (state: WeverseState | undefined) => WeverseState,
  ) {
    this.value = update(this.value && structuredClone(this.value));
    return structuredClone(this.value);
  }
}
const terms = [
  { termsCode: 'age', termsDocumentId: 'age-v1', title: 'I am over 16 years old.', required: true },
  {
    termsCode: 'terms',
    termsDocumentId: 'terms-v1',
    title: 'Account Terms (Required)',
    required: true,
  },
  {
    termsCode: 'marketing',
    termsDocumentId: 'marketing-v1',
    title: 'Marketing messages',
    required: false,
  },
];
let server: Server, origin: string, browsers: BrowserManager;
let sends = 0,
  signups = 0,
  tamper = false,
  duplicate = false,
  authFails = false,
  loseResponse = false;
let lastPayload: any,
  trackingCreated = false;
let overseasTamper = false;
const fixtureHtml =
  () => `<!doctype html><html><body><button onclick="entry.hidden=false;this.remove()">Refuse and continue</button><button id="entry" hidden>Sign up with email</button><main id="main"></main><script>
const terms=${JSON.stringify(terms)};
const api=async (path,body,headers={})=>{const response=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});if(!response.ok)throw Error('request');return response.json()};
api('/web/api/v4/weverse');
let session,auth;
if(new URL(location.href).searchParams.get('redirect_method')!=='COOKIE')throw Error('Wrong redirect mode');
entry.onclick=()=>{history.pushState({},'', '/en/signup/credential');main.innerHTML='<label>Email<span>required</span><input id="email" type="email" placeholder="your@email.com"></label><label>Password<span>required</span><input id="password" type="password" placeholder="Password"></label><label>Confirm new password<span>required</span><input id="confirm" type="password" placeholder="Confirm new password"></label><label>Username<span>required</span><input id="nickname" placeholder="Enter Nickname"></label><label>Block Overseas Logins<input type="checkbox" id="overseas" checked></label><button id="send">Send Verification Code</button><section id="otpBox" hidden><label>Verification Code<span>required</span><input id="otp" placeholder="6-digit Verification Code"></label><button id="verify">Verify Code</button></section><button id="next" disabled>Next</button><section id="consents"></section>';
send.onclick=async()=>{session=await api('/web/api/v2/signup/otp-sessions',{email:email.value});await api('/web/api/v2/signup/otp-sessions/'+session.otpSessionId+'/send',{otpSessionId:session.otpSessionId});otpBox.hidden=false;};
verify.onclick=async()=>{auth=await api('/web/api/v2/signup/auth-codes',{email:email.value,otpSessionId:session.otpSessionId,otpCode:otp.value});next.disabled=false;};
next.onclick=async()=>{await api('/web/api/v2/resources/bad-words',{text:nickname.value});const data=await api('/web/api/v4/terms/signup/weverse');consents.innerHTML='<label>Agree to All<input id="agreeAll" type="checkbox"></label>'+data.terms.map((t,i)=>'<label'+(i>0?' hidden':'')+'>'+t.title+'<input type="checkbox" id="term'+i+'"></label>').join('')+'<button id="submit" disabled>Sign up now</button>';agreeAll.onchange=()=>{terms.forEach((t,i)=>document.querySelector('#term'+i).checked=agreeAll.checked);submit.disabled=!agreeAll.checked;};submit.onclick=async()=>{const payload={email:email.value,password:password.value,nickname:nickname.value,authCode:auth.authCode,serviceId:'weverse',timeZone:'Asia/Seoul',blockOverseasSignin:${overseasTamper} || overseas.checked,termsAgreements:terms.map((t,i)=>({termsDocumentId:t.termsDocumentId,agreed:document.querySelector('#term'+i).checked}))};if(${tamper})payload.termsAgreements[2].agreed=false;const result=api('/web/api/v6/signup/by-credentials',payload);if(${duplicate})api('/web/api/v6/signup/by-credentials',payload).catch(()=>{});const created=await result;consents.innerHTML='<button id="start">Start</button>';start.onclick=()=>{history.pushState({},'', '/login/result');api('/api/v1/token/validate',null,{Authorization:'Bearer '+created.accessToken}).catch(()=>{});};};};};
</script></body></html>`;

describe('Weverse adapter with real Chromium and HAR-shaped local responses', () => {
  beforeAll(async () => {
    browsers = new BrowserManager(config);
    server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      const send = (body: unknown) => res.end(JSON.stringify(body));
      if (req.url === '/web/api/v4/weverse')
        return send({ authMethods: { signup: ['EMAIL'] }, timeZoneRequired: true });
      if (req.url === '/web/api/v4/terms/signup/weverse') return send({ terms, termsGroups: [] });
      if (req.url === '/api/v1/token/validate') {
        if (authFails) res.statusCode = 500;
        return send({
          serviceUserId: 'remote-fixture-user',
          expiresIn: 3600,
          refreshRequired: false,
        });
      }
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          const input = JSON.parse(Buffer.concat(chunks).toString());
          if (req.url === '/web/api/v2/signup/otp-sessions')
            return send({ otpSessionId: 'fixture-otp-session' });
          if (req.url?.endsWith('/send')) {
            sends++;
            expect(trackingCreated).toBe(true);
            return send({ expiresIn: 120 });
          }
          if (req.url === '/web/api/v2/signup/auth-codes')
            return send({
              authCode: 'fixture-auth-code',
              expiredAt: new Date(Date.now() + 60000).toISOString(),
            });
          if (req.url === '/web/api/v2/resources/bad-words')
            return send({ containsBadWords: false });
          if (req.url === '/web/api/v6/signup/by-credentials') {
            signups++;
            lastPayload = input;
            if (loseResponse) return req.socket.destroy();
            return send({
              serviceUserId: 'remote-fixture-user',
              accessToken: 'fixture-access-token',
              refreshToken: 'fixture-refresh-token',
              expiresIn: 3600,
            });
          }
          res.statusCode = 404;
          return send({});
        });
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      res.end(fixtureHtml());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await browsers?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  async function run(
    options: {
      tamper?: boolean;
      duplicate?: boolean;
      authFails?: boolean;
      loseResponse?: boolean;
      overseasTamper?: boolean;
      proxy?: BrowserProxy;
    } = {},
  ) {
    overseasTamper = !!options.overseasTamper;
    sends = 0;
    signups = 0;
    trackingCreated = false;
    tamper = !!options.tamper;
    duplicate = !!options.duplicate;
    authFails = !!options.authFails;
    loseResponse = !!options.loseResponse;
    const exec = execution(),
      store = new MemoryStore();
    const emitted: string[] = [];
    const adapter = new WeverseAdapter({
      store,
      identities: new CatchallManager(),
      otpSender: 'noreply@weverse.io',
      testSite: { accountOrigin: origin, apiOrigin: origin, redirectUri: origin + '/login/result' },
      responseTimeoutMs: 5000,
      event: async (_e, event) => {
        emitted.push(event);
      },
    });
    let requestRecord: any;
    const mailbox = {
      createVerification: async (_id: string, input: any) => {
        trackingCreated = true;
        requestRecord = {
          id: randomUUID(),
          emailConfigId: 'fixture-mailbox',
          ...input,
          expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
        };
        return requestRecord;
      },
      status: async () => requestRecord,
      limitVerificationExpiry: async (_id: string, expiresAt: Date) => {
        requestRecord.expiresAt = expiresAt;
      },
      scan: async () => {
        expect(sends).toBe(1);
        return { status: 'detected' };
      },
      code: async () => '123456',
    } as unknown as EmailManager;
    const lease = await browsers.acquire({
      mode: 'isolated',
      signal: exec.context.signal,
      proxy: options.proxy,
    });
    const ctx: BrowserWorkflowContext = {
      execution: exec.context,
      page: lease.page,
      context: lease.context,
      signal: exec.context.signal,
      profileId: randomUUID(),
      waitForOtp: new EmailVerificationCoordinator(mailbox, 5).bind(
        exec.context,
        'fixture-mailbox',
        'example.test',
      ),
    };
    return { exec, store, emitted, adapter, ctx, mailbox, close: () => lease.close() };
  }
  it('uses tracking before OTP dispatch, selects Agree to All with collapsed child terms and returns confirmed identity', async () => {
    const r = await run();
    try {
      const result = await r.adapter.execute(r.ctx);
      expect(result.account.email).toMatch(/@example\.test$/);
      expect(result.account.password).toBe(lastPayload.password);
      expect(result.sessionDisposition).toBe('save');
      expect(signups).toBe(1);
      expect(lastPayload.blockOverseasSignin).toBe(false);
      expect(r.exec.fences()).toBe(1);
      expect(lastPayload.termsAgreements.map((t: any) => t.agreed)).toEqual([true, true, true]);
      expect((r.exec.context.checkpoint as any).emailVerification.dispatch).toBe('sent');
      expect((r.exec.context.checkpoint as any).weverse.stage).toBe('consent_ready');
      expect(JSON.stringify(r.exec.context.checkpoint)).not.toContain(lastPayload.password);
      expect(r.store.value?.confirmed?.serviceUserId).toBe('remote-fixture-user');
      expect(r.emitted).toContain('task.weverse.authenticated');
    } finally {
      await r.close();
    }
  });
  it('blocks an unchecked consent in the final payload before the external mutation fence', async () => {
    const r = await run({ tamper: true });
    try {
      await expect(r.adapter.execute(r.ctx)).rejects.toMatchObject({
        code: 'WEVERSE_SUBMISSION_MISMATCH',
      });
      expect(signups).toBe(0);
      expect(r.exec.fences()).toBe(0);
    } finally {
      await r.close();
    }
  });
  it('blocks duplicate browser submissions and preserves confirmed accounts when token validation fails', async () => {
    const r = await run({ duplicate: true, authFails: true });
    try {
      const result = await r.adapter.execute(r.ctx);
      expect(signups).toBe(1);
      expect(r.exec.fences()).toBe(1);
      expect(result.sessionDisposition).toBe('skip');
      const restored = new WeverseAdapter({
        store: r.store,
        identities: new CatchallManager(),
        otpSender: 'noreply@weverse.io',
      });
      expect((await restored.recover(r.exec.context))?.account).toEqual(result.account);
      expect(signups).toBe(1);
    } finally {
      await r.close();
    }
  });
  it('blocks submission if the frontend re-enables overseas login blocking', async () => {
    const r = await run({ overseasTamper: true });
    try {
      await expect(r.adapter.execute(r.ctx)).rejects.toMatchObject({
        code: 'WEVERSE_OVERSEAS_BLOCK_ENABLED',
      });
      expect(signups).toBe(0);
      expect(r.exec.fences()).toBe(0);
    } finally {
      await r.close();
    }
  });
  it('switches a reused pool slot between hidden and visible Chromium processes', async () => {
    for (const headless of [true, false, true]) {
      const lease = await browsers.acquire({
        mode: 'isolated',
        headless,
        signal: new AbortController().signal,
      });
      try {
        const cdp = await lease.context.browser()!.newBrowserCDPSession();
        const result = await cdp.send('Browser.getVersion');
        expect(result.userAgent.includes('HeadlessChrome')).toBe(headless);
        await cdp.detach();
      } finally {
        await lease.close();
      }
    }
  });
  it('keeps the draft identity across a safe retry but requests a fresh OTP for the new browser form', async () => {
    const first = await run({ tamper: true });
    try {
      await expect(first.adapter.execute(first.ctx)).rejects.toMatchObject({
        code: 'WEVERSE_SUBMISSION_MISMATCH',
      });
    } finally {
      await first.close();
    }
    const identity = structuredClone(first.store.value!.identity);
    const retry = await run();
    retry.exec.context.taskId = first.exec.context.taskId;
    retry.exec.context.checkpoint = structuredClone(first.exec.context.checkpoint);
    const adapter = new WeverseAdapter({
      store: first.store,
      identities: new CatchallManager(),
      otpSender: 'noreply@weverse.io',
      testSite: { accountOrigin: origin, apiOrigin: origin, redirectUri: origin + '/login/result' },
      responseTimeoutMs: 5000,
    });
    try {
      const result = await adapter.execute(retry.ctx);
      expect(result.account.email).toBe(identity.email);
      expect(result.account.password).toBe(identity.password);
      expect(sends).toBe(1);
      expect(signups).toBe(1);
    } finally {
      await retry.close();
    }
  });
  it('keeps the final single-attempt transport on the assigned authenticated proxy', async () => {
    let finalThroughProxy = 0;
    const proxy = createServer((req, res) => {
      if (
        req.headers['proxy-authorization'] !==
        'Basic ' + Buffer.from('fixture:secret').toString('base64')
      ) {
        res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="fixture"' });
        res.end();
        return;
      }
      const target = new URL(req.url!);
      if (target.origin !== origin) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (target.pathname === '/web/api/v6/signup/by-credentials') finalThroughProxy++;
      const headers = { ...req.headers };
      delete headers['proxy-authorization'];
      const forwarded = httpRequest(target, { method: req.method, headers }, (response) => {
        res.writeHead(response.statusCode!, response.headers);
        response.pipe(res);
      });
      forwarded.on('error', () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(forwarded);
    });
    const tunnels = new Set<Socket>();
    proxy.on('connect', (req, client, head) => {
      if (
        req.url !== new URL(origin).host ||
        req.headers['proxy-authorization'] !==
          'Basic ' + Buffer.from('fixture:secret').toString('base64')
      ) {
        client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }
      const upstream = netConnect(Number(new URL(origin).port), '127.0.0.1');
      tunnels.add(upstream);
      upstream.once('close', () => tunnels.delete(upstream));
      upstream.once('error', () => client.destroy());
      client.once('error', () => upstream.destroy());
      let header = '';
      client.on('data', (data) => {
        if (header.length < 8192) {
          header += data.toString();
          if (header.includes('POST /web/api/v6/signup/by-credentials ')) {
            finalThroughProxy++;
            header = 'x'.repeat(8192);
          }
        }
      });
      upstream.once('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const r = await run({
      proxy: {
        id: randomUUID(),
        server: `http://127.0.0.1:${(proxy.address() as { port: number }).port}`,
        username: 'fixture',
        password: 'secret',
      },
    });
    try {
      await r.adapter.execute(r.ctx);
      expect(signups).toBe(1);
      expect(finalThroughProxy).toBe(1);
    } finally {
      await r.close();
      for (const socket of tunnels) socket.destroy();
      proxy.closeAllConnections();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });
  it.each([false, true])(
    'integrates WorkerExecutor and AccountManager, including confirmed-result recovery=%s',
    async (recover) => {
      const r = await run();
      await r.close();
      const record: any = {
        id: r.exec.context.runId,
        taskId: r.exec.context.taskId,
        leaseToken: r.exec.context.leaseToken,
        status: 'RUNNING',
        outcome: 'NOT_CREATED',
      };
      const task = {
        id: r.exec.context.taskId,
        workflow: 'create-account',
        emailConfigId: 'fixture-mailbox',
      };
      const accounts: any[] = [],
        logs: any[] = [];
      let savedSessions = 0;
      const db: any = {
        $queryRaw: async () => [],
        task: { findUniqueOrThrow: async () => task, findUnique: async () => task },
        taskRun: {
          findUniqueOrThrow: async () => record,
          findUnique: async () => record,
          update: async ({ data }: any) => Object.assign(record, data),
        },
        account: {
          findFirst: async () => accounts[0],
          create: async ({ data }: any) => {
            accounts.push(data);
            return { id: data.id, email: data.email };
          },
        },
        log: {
          create: async ({ data }: any) => {
            logs.push(data);
            return data;
          },
        },
      };
      db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);
      const before = r.exec.context.beforeExternalMutation;
      r.exec.context.beforeExternalMutation = async () => {
        await before();
        record.outcome = 'UNKNOWN';
      };
      const cipher = new AesSecretCipher(randomBytes(32).toString('base64'));
      if (recover) {
        const mutate = r.store.mutate.bind(r.store);
        let failed = false;
        r.store.mutate = async (execution, update) => {
          const state = await mutate(execution, update);
          if (state.confirmed && !failed) {
            failed = true;
            throw Error('fixture: journal write confirmed but acknowledgement lost');
          }
          return state;
        };
      }
      const dependencies = {
        db,
        config,
        logger: createLogger('silent'),
        browsers,
        workflows: { get: () => r.adapter },
        accounts: new AccountManager(new AccountRepository(db), cipher),
        emailVerification: new EmailVerificationCoordinator(r.mailbox, 5),
        profiles: {
          acquire: async (owner: any) => ({ id: randomUUID(), mode: 'isolated', owner }),
          repository: { owned: async () => ({ stateVersion: 0 }), bindProxy: async () => {} },
          renew: async () => true,
          release: async () => true,
        },
        assignments: {},
        rotation: { preferredForRetry: async () => ({}), next: async () => undefined },
        storage: { load: async () => undefined },
        sessions: {
          save: async () => {
            savedSessions++;
          },
        },
      } as unknown as EngineDependencies;
      try {
        await new WorkerExecutor(dependencies).execute(r.exec.context);
        expect(signups).toBe(1);
        expect(accounts).toHaveLength(1);
        expect(record.outcome).toBe('CREATED');
        expect(cipher.open(accounts[0].passwordCipher, `account:${accounts[0].id}`)).toBe(
          r.store.value!.identity.password,
        );
        expect(savedSessions).toBe(recover ? 0 : 1);
        expect(JSON.stringify(logs)).not.toContain(r.store.value!.identity.password);
        expect(browsers.status.active).toBe(0);
      } finally {
        await r.close();
      }
    },
  );
  it('leaves an unknown result when the server creates an account but the response is lost', async () => {
    const r = await run({ loseResponse: true });
    try {
      await expect(r.adapter.execute(r.ctx)).rejects.toThrow();
      expect(signups).toBe(1);
      expect(r.exec.outcome()).toBe('UNKNOWN');
      expect(await r.adapter.recover(r.exec.context)).toBeUndefined();
    } finally {
      await r.close();
    }
  });
});

describe('production workflow wiring and encrypted drafts', () => {
  it('registers create-account in production while keeping the generic engine registry explicit', async () => {
    const db = {} as Database,
      logger = createLogger('silent');
    const production = createProductionEngine(config, db, logger),
      generic = createEngine(config, db, logger);
    expect(production.workflows.keys).toEqual(['create-account']);
    expect(generic.workflows.keys).toEqual([]);
    expect(production.browsers.status.processes).toBe(0);
    await production.close();
    await generic.close();
  });
  it('encrypts identity/auth state, reloads it and refuses a stale task lease', async () => {
    const exec = execution();
    let row: any;
    const tx = {
      $queryRaw: async () => [],
      task: {
        findUnique: async () => ({ id: exec.context.taskId, currentRunId: exec.context.runId }),
      },
      taskRun: {
        findUnique: async () => ({
          id: exec.context.runId,
          taskId: exec.context.taskId,
          leaseToken: exec.context.leaseToken,
          status: 'RUNNING',
        }),
      },
      workflowState: {
        findUnique: async () => row,
        upsert: async ({ create, update }: any) => {
          row = row ? { ...row, ...update } : create;
          return row;
        },
      },
    };
    const db = {
      $transaction: async (run: (tx: unknown) => unknown) => run(tx),
    } as unknown as Database;
    const cipher = new AesSecretCipher(randomBytes(32).toString('base64'));
    const repo = new WorkflowStateRepository(db, cipher);
    const value: WeverseState = {
      version: 1,
      configHash: 'a'.repeat(64),
      identity: {
        email: 'fixture@example.test',
        username: 'fixture',
        password: 'FixturePassword!123',
      },
    };
    await repo.mutate(exec.context, () => value);
    expect(row.payloadCipher).not.toContain(value.identity.password);
    expect(await new WorkflowStateRepository(db, cipher).read(exec.context)).toEqual(value);
    await expect(repo.read({ ...exec.context, leaseToken: randomUUID() })).rejects.toMatchObject({
      code: 'WORKFLOW_LEASE_LOST',
    });
  });
});
