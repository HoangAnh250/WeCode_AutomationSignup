import { ProfileController } from '../controllers/profile.controller.js';
import { Router } from 'express';
import type { Container } from '../composition.js';
import { TaskController } from '../controllers/task.controller.js';
import { AccountController } from '../controllers/account.controller.js';
import { ProxyController } from '../controllers/proxy.controller.js';
import { EmailController } from '../controllers/email.controller.js';
import { IdentityController } from '../controllers/identity.controller.js';
import { ExportController } from '../controllers/export.controller.js';
import { pageSchema } from '../core/pagination.js';
import { offset } from '../core/pagination.js';
import { idSchema, sessionSchema } from '../contracts/schemas.js';
import { z } from 'zod';
import { audit } from '../core/events.js';
export function routes(c: Container) {
  const r = Router();
  const task = new TaskController(c.tasks),
    account = new AccountController(c.accounts),
    proxy = new ProxyController(c.proxies),
    email = new EmailController(c.email),
    identity = new IdentityController(c.catchall),
    exports = new ExportController(c.exports);
  const profile = new ProfileController(c.profiles);
  r.get('/browser-profiles', profile.list);
  r.post('/browser-profiles', profile.create);
  r.delete('/browser-profiles/:id', profile.delete);
  r.patch('/browser-profiles/:id/proxy', profile.assignProxy);
  r.get('/tasks', task.list);
  r.post('/tasks', task.create);
  r.post('/tasks/batch', task.createBatch);
  r.get('/tasks/:id', task.get);
  r.patch('/tasks/:id', task.update);
  r.delete('/tasks/:id', task.delete);
  for (const action of ['start', 'pause', 'resume', 'retry'] as const)
    r.post(`/tasks/:id/${action}`, task.command(action));
  r.get('/task-runs/:id', async (req, res) =>
    res.json(await c.runs.get(idSchema.parse(req.params.id))),
  );
  r.get('/accounts', account.list);
  r.post('/accounts', account.create);
  r.get('/accounts/:id', account.get);
  r.get('/accounts/:id/password', account.password);
  r.get('/exports/accounts', exports.accounts);
  r.get('/proxies', proxy.list);
  r.post('/proxies/import', proxy.import);
  r.post('/proxies/rotate', proxy.rotate);
  r.get('/proxies/statistics', proxy.statistics);
  r.post('/proxies/:id/check', proxy.check);
  r.get('/proxies/:id/health', proxy.history);
  r.patch('/proxies/:id', proxy.enabled);
  r.get('/email-configs', email.list);
  r.get('/email-configs/:id/app-password', email.appPassword);
  r.post('/email-configs', email.create);
  r.patch('/email-configs/:id', email.update);
  r.post('/email-configs/:id/test', email.test);
  r.post('/email-configs/:id/verifications', email.verification);
  r.get('/email-configs/:id/verifications', async (req, res) =>
    res.json(await c.email.verifications(idSchema.parse(req.params.id))),
  );
  r.get('/verifications/:id', email.status);
  r.post('/verifications/:id/scan', email.scan);
  r.get('/verifications/:id/code', email.code);
  r.post('/catchall/identities', identity.generate);
  r.get('/sessions', async (req, res) =>
    res.json(await c.sessions.list(idSchema.parse(req.query.accountId))),
  );
  r.post('/sessions', async (req, res) => {
    const body = sessionSchema.parse(req.body);
    res.status(201).json(await c.sessions.save(body.accountId, body.payload, body.expiresAt));
  });
  r.post('/sessions/:id/revoke', async (req, res) => {
    await c.sessions.revoke(idSchema.parse(req.params.id));
    res.status(204).end();
  });
  r.get('/queue', async (_req, res) => res.json(await c.queue.counts()));
  r.post('/queue/pause', async (_req, res) => {
    await c.queue.pause();
    await audit(c.db, 'queue.paused', 'account-creation');
    res.status(202).json({ paused: true });
  });
  r.post('/queue/resume', async (_req, res) => {
    await c.queue.resume();
    await audit(c.db, 'queue.resumed', 'account-creation');
    res.status(202).json({ paused: false });
  });
  r.get('/logs', async (req, res) => {
    const input = pageSchema
      .extend({ category: z.enum(['audit', 'task', 'queue', 'system']).optional() })
      .parse(req.query);
    res.json(await c.logs.list(input));
  });
  return r;
}
