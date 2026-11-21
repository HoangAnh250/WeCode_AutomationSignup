import type { DesktopClient, DesktopEvent, Task, LogEntry } from '@/types/domain';
import { createPreviewData, createPreviewLogs } from './preview-data';
import { csv, downloadText } from '@/lib/utils';
export function createPreviewClient(): DesktopClient {
  const data = createPreviewData();
  // Export-only fixture credentials are excluded from workspace/list responses.
  const accountPasswords = new Map(
    data.accounts.map(
      (account, index) =>
        [account.id, `PreviewOnly!${String(index + 1).padStart(6, '0')}aB`] as const,
    ),
  );
  let emailPassword = ''; // Preview only: memory for this session, never browser storage.
  let logs = createPreviewLogs();
  const listeners = new Set<(event: DesktopEvent) => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  const emit = (event: DesktopEvent) => listeners.forEach((listener) => listener(event));
  const addLog = (message: string, category: LogEntry['category'] = 'task') => {
    const log: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level: 'info',
      category,
      message,
    };
    logs = [...logs.slice(-499), log];
    emit({ type: 'log.created', log });
  };
  const change = () => emit({ type: 'data.changed' });
  const find = (id: string, revision: number) => {
    const task = data.tasks.find((t) => t.id === id);
    if (!task) throw new Error('Task no longer exists. Refresh the list.');
    if (task.revision !== revision)
      throw new Error('This task changed. Refresh before trying again.');
    return task;
  };
  return {
    mode: 'preview',
    async getWorkspace() {
      return structuredClone(data);
    },
    async createTask(input) {
      const batchId = input.total > 1 ? (input.creationId ?? crypto.randomUUID()) : undefined;
      if (batchId && data.tasks.some((task) => task.batchId === batchId)) return;
      const tasks: Task[] = Array.from({ length: input.total }, (_, offset) => ({
        ...input,
        name:
          input.total > 1
            ? `${input.name} [${String(offset + 1).padStart(String(input.total).length, '0')}/${input.total}]`
            : input.name,
        total: 1,
        id: crypto.randomUUID(),
        batchId,
        batchIndex: batchId ? offset + 1 : undefined,
        batchSize: batchId ? input.total : undefined,
        batchName: batchId ? input.name : undefined,
        status: 'draft',
        progress: 0,
        completed: 0,
        duration: '-',
        retries: 0,
        revision: 1,
        allowedActions: ['start'],
      }));
      data.tasks.unshift(...tasks);
      addLog(`Created ${tasks.length} account task row(s): ${input.name} (preview).`);
      change();
    },
    async updateTask(id, input, revision) {
      const task = find(id, revision);
      if (['running', 'pending', 'needs_reconciliation'].includes(task.status))
        throw new Error('Queued, running and uncertain tasks cannot be edited.');
      Object.assign(task, input, { revision: task.revision + 1 });
      change();
      addLog(`Updated ${id} (preview).`);
    },
    async deleteTask(id, revision) {
      const task = find(id, revision);
      if (task.status === 'running') throw new Error('Pause the task before deleting it.');
      data.tasks = data.tasks.filter((t) => t.id !== id);
      change();
      addLog(`Deleted ${id} (preview).`);
    },
    async taskAction(id, action, revision) {
      const task = find(id, revision);
      if (!task.allowedActions.includes(action))
        throw new Error('This action is unavailable for the current task state.');
      if (action === 'start' && task.status === 'success') {
        task.completed = 0;
        task.progress = 0;
        task.total = 1;
        task.duration = '-';
      }
      task.status = action === 'pause' ? 'paused' : action === 'retry' ? 'pending' : 'running';
      if (action === 'retry') task.retries++;
      task.allowedActions = action === 'pause' ? ['resume'] : ['pause'];
      task.revision++;
      change();
      addLog(`${id}: ${action} confirmed in frontend preview.`);
    },
    async importProxies(input) {
      let imported = 0;
      for (const p of input) {
        if (
          data.proxies.some(
            (x) => x.host === p.host && x.port === p.port && x.protocol === p.protocol,
          )
        )
          continue;
        data.proxies.push({
          id: crypto.randomUUID(),
          host: p.host,
          port: p.port,
          protocol: p.protocol,
          country: 'Not resolved',
          health: 'unknown',
          latency: null,
          assigned: 0,
          hasCredentials: Boolean(p.username),
        });
        imported++;
      }
      change();
      addLog(`Imported ${imported} proxy entries (preview).`, 'system');
      return { imported };
    },
    async checkProxy(id) {
      const p = data.proxies.find((p) => p.id === id);
      if (!p) throw new Error('Proxy no longer exists.');
      p.checkedAt = new Date().toISOString();
      change();
      addLog('Preview: health check requested. No real network probe was performed.', 'network');
    },
    async updateProxy(id, input, revision) {
      const proxy = data.proxies.find((p) => p.id === id);
      if (!proxy) throw new Error('Proxy no longer exists.');
      if ((proxy.revision ?? 1) !== revision) throw new Error('Proxy changed. Refresh first.');
      if (proxy.assigned) throw new Error('Proxy is in use.');
      const endpoint = {
        host: input.host ?? proxy.host,
        port: input.port ?? proxy.port,
        protocol: input.protocol ?? proxy.protocol,
      };
      if (
        data.proxies.some(
          (p) =>
            p.id !== id &&
            p.host === endpoint.host &&
            p.port === endpoint.port &&
            p.protocol === endpoint.protocol,
        )
      )
        throw new Error('Proxy already exists.');
      Object.assign(proxy, endpoint, {
        health: 'unknown',
        latency: null,
        revision: revision + 1,
        hasCredentials:
          input.authMode === 'keep' ? proxy.hasCredentials : input.authMode === 'replace',
      });
      change();
      addLog('Proxy updated (preview).', 'system');
    },
    async deleteProxy(id, revision) {
      const proxy = data.proxies.find((p) => p.id === id);
      if (!proxy) throw new Error('Proxy no longer exists.');
      if ((proxy.revision ?? 1) !== revision) throw new Error('Proxy changed. Refresh first.');
      if (proxy.assigned) throw new Error('Proxy is in use.');
      data.proxies = data.proxies.filter((p) => p.id !== id);
      change();
      addLog('Proxy deleted (preview).', 'system');
    },
    async createProfile(name, proxy) {
      data.profiles.unshift({
        id: crypto.randomUUID(),
        name,
        proxy,
        status: 'idle',
        lastActivity: new Date().toISOString(),
        cookies: 0,
      });
      change();
      addLog(`Created browser profile ${name} (preview).`, 'browser');
    },
    async deleteProfile(id) {
      const p = data.profiles.find((x) => x.id === id);
      if (p?.status === 'running') throw new Error('A running profile cannot be deleted.');
      data.profiles = data.profiles.filter((x) => x.id !== id);
      change();
    },
    async getEmailAppPassword(id) {
      if (id !== data.email.id) throw new Error('Preview inbox no longer exists.');
      return emailPassword;
    },
    async saveEmail(address, appPassword, options) {
      if (appPassword) emailPassword = appPassword;
      data.email = {
        id: data.email.id ?? crypto.randomUUID(),
        address,
        configured: true,
        status: 'unknown',
        ...options,
      };
      if (options) data.preferences.catchallDomain = options.accountDomain;
      change();
      addLog('Preview mailbox configuration saved in memory for this session only.', 'system');
    },
    async getEmailVerifications() {
      return [];
    },
    async testEmail() {
      throw new Error(
        'A real mailbox connection requires the Electron backend. Preview does not connect to Gmail.',
      );
    },
    async savePreferences(input) {
      data.preferences = { ...input };
      if (data.email.configured) data.email.accountDomain = input.catchallDomain;
      change();
      addLog('Workspace preferences saved for this preview session.', 'system');
    },
    async getLogs() {
      return structuredClone(logs);
    },
    async exportAccounts(ids, options) {
      const accounts = ids.length ? data.accounts.filter((a) => ids.includes(a.id)) : data.accounts;
      downloadText(
        'wecode-accounts.csv',
        csv([
          ['Email', 'Username', 'Password', 'Proxy', 'Created at', 'Verification'],
          ...accounts.map((a) => {
            const password = accountPasswords.get(a.id);
            if (!password) throw new Error('Saved preview password is unavailable.');
            return [
              a.email,
              a.username,
              options?.includePasswords ? password : '********',
              a.proxy,
              a.createdAt,
              a.verification,
            ];
          }),
        ]),
      );
    },
    async exportLogs(ids) {
      const chosen = logs.filter((l) => ids.includes(l.id));
      downloadText(
        'wecode-preview.log',
        chosen.map((l) => `${l.timestamp} [${l.level}] [${l.category}] ${l.message}`).join('\n'),
        'text/plain;charset=utf-8',
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      if (!timer)
        timer = setInterval(
          () => addLog('Preview heartbeat / browser workers idle between steps.', 'system'),
          12000,
        );
      return () => {
        listeners.delete(listener);
        if (!listeners.size && timer) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
  };
}
