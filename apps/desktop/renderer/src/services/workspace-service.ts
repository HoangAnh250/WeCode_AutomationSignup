import { client } from '@/ipc/client';
import type { TaskInput, TaskAction, Preferences, ProxyInput } from '@/types/domain';
export const workspaceService = {
  load: () => client.getWorkspace(),
  logs: () => client.getLogs(),
  createTask: (input: TaskInput) => client.createTask(input),
  updateTask: (id: string, input: TaskInput, revision: number) =>
    client.updateTask(id, input, revision),
  deleteTask: (id: string, revision: number) => client.deleteTask(id, revision),
  taskAction: (id: string, action: TaskAction, revision: number) =>
    client.taskAction(id, action, revision),
  importProxies: (input: ProxyInput[]) => client.importProxies(input),
  savePreferences: (input: Preferences) => client.savePreferences(input),
};
