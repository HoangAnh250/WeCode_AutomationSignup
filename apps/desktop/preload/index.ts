import { contextBridge, ipcRenderer } from "electron";
import type { DesktopMethods, Reply } from "../shared/contracts";
import type { DesktopEvent } from "../renderer/src/types/domain";
const call = async <T>(method: string, ...args: unknown[]): Promise<T> => {
  const reply = (await ipcRenderer.invoke(
    `wecode:${method}`,
    ...args,
  )) as Reply<T>;
  if (!reply.ok) throw new Error(reply.error.message);
  return reply.value;
};
// Only fixed capabilities are exposed. No generic invoke, filesystem, process or event object.
const client: DesktopMethods & {
  subscribe: (listener: (event: DesktopEvent) => void) => () => void;
} = {
  getWorkspace: () => call("getWorkspace"),
  createTask: (input) => call("createTask", input),
  updateTask: (id, input, revision) => call("updateTask", id, input, revision),
  deleteTask: (id, revision) => call("deleteTask", id, revision),
  taskAction: (id, action, revision) =>
    call("taskAction", id, action, revision),
  importProxies: (input) => call("importProxies", input),
  checkProxy: (id) => call("checkProxy", id),
  updateProxy: (id, input, revision) =>
    call("updateProxy", id, input, revision),
  deleteProxy: (id, revision) => call("deleteProxy", id, revision),
  createProfile: (name, proxy) => call("createProfile", name, proxy),
  deleteProfile: (id) => call("deleteProfile", id),
  saveEmail: (address, password, options) =>
    call("saveEmail", address, password, options),
  getEmailAppPassword: (id) => call("getEmailAppPassword", id),
  getEmailVerifications: () => call("getEmailVerifications"),
  testEmail: () => call("testEmail"),
  savePreferences: (input) => call("savePreferences", input),
  getLogs: () => call("getLogs"),
  exportAccounts: (ids, options) => call("exportAccounts", ids, options),
  exportLogs: (ids) => call("exportLogs", ids),
  subscribe: (listener) => {
    if (typeof listener !== "function")
      throw new Error("Invalid desktop event listener.");
    const callback = (
      _event: Electron.IpcRendererEvent,
      value: DesktopEvent,
    ) => {
      if (
        value &&
        (value.type === "data.changed" || value.type === "log.created")
      )
        listener(value);
    };
    ipcRenderer.on("wecode:event", callback);
    return () => ipcRenderer.removeListener("wecode:event", callback);
  },
};
const versionArgument = process.argv.find((argument) =>
  argument.startsWith("--wecode-app-version="),
);
const version = versionArgument?.slice("--wecode-app-version=".length);
const appVersion =
  version && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
    ? version
    : undefined;
contextBridge.exposeInMainWorld(
  "wecode",
  Object.freeze({
    protocolVersion: 1,
    appVersion,
    client: Object.freeze(client),
  }),
);
