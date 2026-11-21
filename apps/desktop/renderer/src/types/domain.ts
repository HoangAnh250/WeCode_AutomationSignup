export type PageId =
  'dashboard' | 'tasks' | 'proxies' | 'profiles' | 'accounts' | 'email' | 'logs' | 'settings';
export type TaskStatus =
  | 'draft'
  | 'pending'
  | 'running'
  | 'paused'
  | 'success'
  | 'failed'
  | 'blocked'
  | 'needs_reconciliation';
export type TaskAction = 'start' | 'pause' | 'resume' | 'retry';
export interface Task {
  assignedProxy?: string;
  showBrowser?: boolean;
  batchId?: string;
  batchIndex?: number;
  batchSize?: number;
  batchName?: string;
  id: string;
  name: string;
  workflow: string;
  status: TaskStatus;
  progress: number;
  completed: number;
  total: number;
  proxy: string;
  profile: string;
  duration: string;
  retries: number;
  allowedActions: TaskAction[];
  revision: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  businessOutcome?: string;
  retryable?: boolean;
}
export interface TaskInput {
  /** Bulk edits keep the existing identity policy and mailbox. */
  preserveIdentity?: boolean;
  showBrowser?: boolean;
  creationId?: string;
  name: string;
  workflow: string;
  total: number;
  proxy: string;
  profile: string;
}
export interface Proxy {
  id: string;
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'socks5';
  country: string;
  health: 'healthy' | 'unknown' | 'unreachable';
  latency: number | null;
  assigned: number;
  hasCredentials: boolean;
  checkedAt?: string;
}
export interface ProxyInput {
  host: string;
  port: number;
  protocol: Proxy['protocol'];
  username?: string;
  password?: string;
}
export interface Profile {
  id: string;
  name: string;
  proxy: string;
  status: 'idle' | 'running' | 'paused';
  lastActivity: string;
  cookies: number;
}
export interface Account {
  id: string;
  email: string;
  username: string;
  proxy: string;
  createdAt: string;
  verification: 'verified' | 'pending' | 'failed';
}
export type LogLevel = 'info' | 'success' | 'warn' | 'error';
export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: 'task' | 'browser' | 'network' | 'queue' | 'system';
  message: string;
  taskId?: string;
}
export interface EmailConnectionOptions {
  accountDomain: string;
  host: string;
  port: number;
  mailbox: string;
}
export interface EmailVerification {
  id: string;
  recipient: string;
  sender: string;
  status: string;
  requestedAt: string;
  expiresAt: string;
}
export interface EmailSettings {
  id?: string;
  accountDomain?: string;
  host?: string;
  port?: number;
  mailbox?: string;
  address: string;
  configured: boolean;
  status: 'connected' | 'disconnected' | 'unknown';
  lastChecked?: string;
}
export interface Preferences {
  concurrency: number;
  catchallDomain: string;
  usernamePrefix: string;
  usernameLength: number;
  passwordLength: number;
  uppercase: boolean;
  numbers: boolean;
  symbols: boolean;
}
export interface WorkspaceData {
  tasks: Task[];
  proxies: Proxy[];
  profiles: Profile[];
  accounts: Account[];
  email: EmailSettings;
  preferences: Preferences;
}
export interface DesktopEvent {
  type: 'data.changed' | 'log.created';
  log?: LogEntry;
}
export interface DesktopClient {
  mode: 'desktop' | 'preview' | 'unavailable';
  getWorkspace(): Promise<WorkspaceData>;
  createTask(input: TaskInput): Promise<void>;
  updateTask(id: string, input: TaskInput, revision: number): Promise<void>;
  deleteTask(id: string, revision: number): Promise<void>;
  taskAction(id: string, action: TaskAction, revision: number): Promise<void>;
  importProxies(input: ProxyInput[]): Promise<{ imported: number }>;
  checkProxy(id: string): Promise<void>;
  createProfile(name: string, proxy: string): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  saveEmail(address: string, appPassword?: string, options?: EmailConnectionOptions): Promise<void>;
  getEmailAppPassword(id: string): Promise<string>;
  getEmailVerifications(): Promise<EmailVerification[]>;
  testEmail(): Promise<void>;
  savePreferences(input: Preferences): Promise<void>;
  getLogs(): Promise<LogEntry[]>;
  exportAccounts(ids: string[], options?: { includePasswords: boolean }): Promise<void>;
  exportLogs(ids: string[]): Promise<void>;
  subscribe(listener: (event: DesktopEvent) => void): () => void;
}
