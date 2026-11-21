import { ProxyPreflight } from './ProxyPreflight.js';
import { ProxyManager } from '../services/proxy.service.js';
import { ProxyRepository } from '../repositories/proxy.repository.js';
import { NodeProxyProbe, type ProxyProbe } from '../infrastructure/proxy-probe.js';
import { EmailVerificationCoordinator } from './EmailVerificationCoordinator.js';
import { EmailManager } from '../services/email.service.js';
import { EmailRepository } from '../repositories/email.repository.js';
import { ImapGateway } from '../infrastructure/imap.gateway.js';
import { automationDataDirectory } from './paths.js';
import type { Config } from '../core/config.js';
import type { Database } from '../infrastructure/database.js';
import type { Logger } from '../infrastructure/logger.js';
import { AesSecretCipher } from '../core/crypto.js';
import { AccountManager } from '../services/account.service.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { BrowserManager } from './BrowserManager.js';
import { ProfileRepository } from './repositories/profile.repository.js';
import { ProfileManager } from './ProfileManager.js';
import { ProxyAssignmentService } from './ProxyAssignmentService.js';
import { ProxyRotationService } from './ProxyRotationService.js';
import { SessionManager } from './SessionManager.js';
import { StorageStateManager } from './StorageStateManager.js';
import { WorkerExecutor } from './WorkerExecutor.js';
import { WorkflowRegistry } from './WorkflowRegistry.js';
export function createEngine(
  config: Config,
  db: Database,
  logger: Logger,
  workflows = new WorkflowRegistry(),
  options: { probe?: ProxyProbe } = {},
) {
  const cipher = new AesSecretCipher(config.ENCRYPTION_KEY);
  const accounts = new AccountManager(new AccountRepository(db), cipher);
  const root = automationDataDirectory(config);
  const profiles = new ProfileManager(
    new ProfileRepository(db, config.INSTALLATION_ID, config.BROWSER_LEASE_SECONDS),
    root,
  );
  const browsers = new BrowserManager(config);
  const storage = new StorageStateManager(profiles.repository, cipher);
  const assignments = new ProxyAssignmentService(db, cipher, config.BROWSER_LEASE_SECONDS);
  const rotation = new ProxyRotationService(db, assignments);
  const sessions = new SessionManager(db, cipher, storage, config.BROWSER_SESSION_TTL_SECONDS);
  const dependencies = {
    config,
    db,
    logger,
    accounts,
    emailVerification: new EmailVerificationCoordinator(
      new EmailManager(new EmailRepository(db), cipher, new ImapGateway()),
    ),
    browsers,
    profiles,
    storage,
    assignments,
    rotation,
    sessions,
    workflows,
    proxyHealth: new ProxyPreflight(
      db,
      new ProxyManager(
        new ProxyRepository(db),
        cipher,
        options.probe ?? new NodeProxyProbe(config.PROXY_PROBE_URL),
        config.ENCRYPTION_KEY,
      ),
    ),
  };
  return {
    ...dependencies,
    executor: new WorkerExecutor(dependencies),
    close: () => browsers.close(),
  };
}
