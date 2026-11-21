import { client } from '@/ipc/client';
import type { TaskInput, TaskAction, Preferences, ProxyInput, Task } from '@/types/domain';
export const workspaceService = {
  load: () => client.getWorkspace(),
  logs: () => client.getLogs(),
  createTask: (input: TaskInput) => client.createTask(input),
  updateTask: (id: string, input: TaskInput, revision: number) =>
    client.updateTask(id, input, revision),
  deleteTask: (id: string, revision: number) => client.deleteTask(id, revision),
  taskAction: (id: string, action: TaskAction, revision: number) =>
    client.taskAction(id, action, revision),
  startTasks: async (tasks: Pick<Task, 'id' | 'revision'>[]) => {
    const outcomes: boolean[] = [];
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) {
        const index = next++;
        const task = tasks[index];
        try {
          await client.taskAction(task.id, 'start', task.revision);
          outcomes[index] = true;
        } catch {
          outcomes[index] = false;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, tasks.length) }, worker));
    return {
      started: outcomes.filter(Boolean).length,
      unconfirmed: outcomes.filter((value) => !value).length,
    };
  },
  importProxies: (input: ProxyInput[]) => client.importProxies(input),
  savePreferences: (input: Preferences) => client.savePreferences(input),
};

export interface TaskBatchResult {
  succeeded: string[];
  failed: { id: string; name: string; message: string }[];
}
// No implicit retry: a lost response may already have committed a versioned command.
export async function applyToTasks(
  tasks: Task[],
  operation: (task: Task) => Promise<unknown>,
  progress?: (completed: number, total: number) => void,
): Promise<TaskBatchResult> {
  const result: TaskBatchResult = { succeeded: [], failed: [] };
  for (const task of tasks) {
    try {
      await operation(task);
      result.succeeded.push(task.id);
    } catch (error) {
      result.failed.push({
        id: task.id,
        name: task.name,
        message: error instanceof Error ? error.message : 'Command could not be confirmed.',
      });
    }
    progress?.(result.succeeded.length + result.failed.length, tasks.length);
  }
  return result;
}
