import type { BrowserContext, Page } from 'playwright';
import type { AccountCreate } from '../contracts/schemas.js';
import type { WaitForOtp } from './EmailVerificationCoordinator.js';
import type { ExecutionContext } from '../queue/executor.js';
type PlaywrightState = Awaited<ReturnType<BrowserContext['storageState']>>;
export type StorageState = Omit<PlaywrightState, 'origins'> & {
  origins: (PlaywrightState['origins'][number] & { indexedDB?: unknown[] })[];
};
export interface LeaseOwner {
  runId: string;
  token: string;
}
export interface ProfileLease {
  id: string;
  name: string;
  mode: 'isolated' | 'persistent';
  installationId: string;
  assignedProxyId: string | null;
  owner: LeaseOwner;
}
export interface BrowserProxy {
  id: string;
  server: string;
  username?: string;
  password?: string;
}
export interface ProxyLease {
  id: string;
  proxy: BrowserProxy;
  owner: LeaseOwner;
}
export interface BrowserLease {
  id: string;
  context: BrowserContext;
  page: Page;
  signal: AbortSignal;
  version: string;
  close(): Promise<void>;
}
export interface WorkflowResult {
  account: Omit<AccountCreate, 'taskRunId'>;
  sessionExpiresAt?: Date;
}
export interface BrowserWorkflowContext {
  execution: ExecutionContext;
  page: Page;
  context: BrowserContext;
  signal: AbortSignal;
  profileId: string;
  restoredAccountId?: string;
  waitForOtp?: WaitForOtp;
}
export interface BrowserWorkflow {
  readonly key: string;
  execute(context: BrowserWorkflowContext): Promise<WorkflowResult>;
  validateSession?(context: BrowserWorkflowContext, accountId: string): Promise<boolean>;
}
