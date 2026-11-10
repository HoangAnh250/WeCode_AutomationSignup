import type { DesktopClient, WorkspaceData, LogEntry } from '@/types/domain';
import { createPreviewClient } from '@/services/preview-client';
const unavailable = () =>
  Promise.reject(
    new Error(
      'Desktop services are unavailable. Open this renderer inside Electron with the WeCode preload bridge.',
    ),
  );
const offline: DesktopClient = {
  mode: 'unavailable',
  getWorkspace: unavailable,
  createTask: unavailable,
  updateTask: unavailable,
  deleteTask: unavailable,
  taskAction: unavailable,
  importProxies: unavailable,
  checkProxy: unavailable,
  createProfile: unavailable,
  deleteProfile: unavailable,
  saveEmail: unavailable,
  getEmailVerifications: unavailable,
  testEmail: unavailable,
  savePreferences: unavailable,
  getLogs: unavailable,
  exportAccounts: unavailable,
  exportLogs: unavailable,
  subscribe: () => () => {},
};
function desktop(): DesktopClient | undefined {
  const bridge = window.wecode;
  if (!bridge || bridge.protocolVersion !== 1) return;
  const c = bridge.client;
  const methods = [
    'getWorkspace',
    'createTask',
    'updateTask',
    'deleteTask',
    'taskAction',
    'importProxies',
    'checkProxy',
    'createProfile',
    'deleteProfile',
    'saveEmail',
    'testEmail',
    'savePreferences',
    'getLogs',
    'exportAccounts',
    'exportLogs',
    'subscribe',
  ] as const;
  if (!c || methods.some((m) => typeof c[m] !== 'function')) return;
  return {
    mode: 'desktop',
    getWorkspace: async () => {
      const d: WorkspaceData = await c.getWorkspace();
      if (
        !d ||
        !Array.isArray(d.tasks) ||
        !Array.isArray(d.proxies) ||
        !Array.isArray(d.profiles) ||
        !Array.isArray(d.accounts) ||
        !d.email ||
        !d.preferences
      )
        throw new Error('Invalid workspace response from desktop services.');
      return d;
    },
    createTask: (...a) => c.createTask(...a),
    updateTask: (...a) => c.updateTask(...a),
    deleteTask: (...a) => c.deleteTask(...a),
    taskAction: (...a) => c.taskAction(...a),
    importProxies: (...a) => c.importProxies(...a),
    checkProxy: (...a) => c.checkProxy(...a),
    createProfile: (...a) => c.createProfile(...a),
    deleteProfile: (...a) => c.deleteProfile(...a),
    saveEmail: (...a) => c.saveEmail(...a),
    getEmailVerifications: () =>
      typeof c.getEmailVerifications === 'function'
        ? c.getEmailVerifications()
        : Promise.reject(new Error('Update Electron to load verification tracking.')),
    testEmail: () => c.testEmail(),
    savePreferences: (...a) => c.savePreferences(...a),
    getLogs: async () => {
      const logs: LogEntry[] = await c.getLogs();
      if (!Array.isArray(logs)) throw new Error('Invalid log response from desktop services.');
      return logs;
    },
    exportAccounts: (...a) => c.exportAccounts(...a),
    exportLogs: (...a) => c.exportLogs(...a),
    subscribe: (listener) =>
      c.subscribe((event) => {
        if (event && (event.type === 'data.changed' || event.type === 'log.created'))
          listener(event);
      }),
  };
}
export const client: DesktopClient =
  desktop() ??
  (import.meta.env.DEV && new URLSearchParams(location.search).get('preview') !== 'off'
    ? createPreviewClient()
    : offline);
