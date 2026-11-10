import { ProfileManager } from './automation/ProfileManager.js';
import { ProfileRepository } from './automation/repositories/profile.repository.js';
import { automationDataDirectory } from './automation/paths.js';
import { SessionRepository } from './repositories/session.repository.js';
import { LogRepository } from './repositories/log.repository.js';
import { TaskRunRepository } from './repositories/task-run.repository.js';
import { LogManager } from './services/log.service.js';
import type { Config } from './core/config.js';
import { AesSecretCipher } from './core/crypto.js';
import { createDatabase, type Database } from './infrastructure/database.js';
import { createLogger, type Logger } from './infrastructure/logger.js';
import { ImapGateway, type MailGateway } from './infrastructure/imap.gateway.js';
import { NodeProxyProbe, type ProxyProbe } from './infrastructure/proxy-probe.js';
import { TaskRepository } from './repositories/task.repository.js';
import { AccountRepository } from './repositories/account.repository.js';
import { ProxyRepository } from './repositories/proxy.repository.js';
import { EmailRepository } from './repositories/email.repository.js';
import { TaskManager } from './services/task.service.js';
import { AccountManager } from './services/account.service.js';
import { ProxyManager } from './services/proxy.service.js';
import { EmailManager } from './services/email.service.js';
import { CatchallManager } from './services/identity.service.js';
import { ExportManager } from './services/export.service.js';
import { SessionManager } from './services/session.service.js';
import { BullTaskQueue, type QueuePort } from './queue/runtime.js';
import { OutboxDispatcher } from './queue/outbox.js';
export function createContainer(
  config: Config,
  overrides: {
    db?: Database;
    queue?: QueuePort;
    mail?: MailGateway;
    probe?: ProxyProbe;
    logger?: Logger;
  } = {},
) {
  const db = overrides.db ?? createDatabase(config.DATABASE_URL);
  const logger = overrides.logger ?? createLogger(config.LOG_LEVEL);
  const cipher = new AesSecretCipher(config.ENCRYPTION_KEY);
  const queue = overrides.queue ?? new BullTaskQueue(config.REDIS_URL, config.INSTALLATION_ID);
  const accounts = new AccountManager(new AccountRepository(db), cipher);
  return {
    config,
    db,
    logger,
    queue,
    cipher,
    tasks: new TaskManager(new TaskRepository(db)),
    accounts,
    profiles: new ProfileManager(
      new ProfileRepository(db, config.INSTALLATION_ID, config.BROWSER_LEASE_SECONDS),
      automationDataDirectory(config),
    ),
    proxies: new ProxyManager(
      new ProxyRepository(db),
      cipher,
      overrides.probe ?? new NodeProxyProbe(config.PROXY_PROBE_URL),
      config.ENCRYPTION_KEY,
    ),
    email: new EmailManager(new EmailRepository(db), cipher, overrides.mail ?? new ImapGateway()),
    catchall: new CatchallManager(),
    exports: new ExportManager(accounts),
    sessions: new SessionManager(new SessionRepository(db), cipher),
    logs: new LogManager(new LogRepository(db)),
    runs: new TaskRunRepository(db),
    outbox: new OutboxDispatcher(db, queue, logger),
  };
}
export type Container = ReturnType<typeof createContainer>;
