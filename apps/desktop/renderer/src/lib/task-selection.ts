import type { Task } from '@/types/domain';
export const canEditTask = (task: Task) =>
  ['draft', 'paused', 'failed', 'blocked', 'success'].includes(task.status) &&
  task.businessOutcome !== 'UNKNOWN' &&
  (task.businessOutcome !== 'CREATED' || task.status === 'success');
export const canDeleteTask = (task: Task) =>
  !['running', 'pending', 'needs_reconciliation'].includes(task.status) &&
  task.businessOutcome !== 'UNKNOWN';
export function taskRange(rows: Task[], from: number, to: number): string[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > rows.length)
    throw new Error(`Enter a row range from 1 to ${rows.length}, with From <= To.`);
  return rows.slice(from - 1, to).map((task) => task.id);
}
