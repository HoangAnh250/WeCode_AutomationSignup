import { useState } from 'react';
import { Plus, Play, Pause, Pencil, Trash2, ListFilter, RotateCcw } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { SearchInput } from '@/components/shared/SearchInput';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { useCommand } from '@/hooks/useWorkspace';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useWorkbench } from '@/stores/workbench.store';
import { workspaceService } from '@/services/workspace-service';
import type { Task, TaskAction, WorkspaceData } from '@/types/domain';
export function TasksPage({
  data,
  onCreate,
  onEdit,
}: {
  data: WorkspaceData;
  onCreate: () => void;
  onEdit: (task: Task) => void;
}) {
  const batchId = useWorkbench((state) => state.taskBatchId);
  const selectBatch = useWorkbench((state) => state.selectTaskBatch);
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search);
  const [status, setStatus] = useState('all');
  const [deleting, setDeleting] = useState<Task | null>(null);
  const action = useCommand(
    ({ task, action }: { task: Task; action: TaskAction }) =>
      workspaceService.taskAction(task.id, action, task.revision),
    'Task command completed.',
  );
  const startAll = useCommand(async (tasks: Task[]) => {
    const result = await workspaceService.startTasks(tasks);
    if (result.unconfirmed)
      throw new Error(
        `Queued ${result.started} rows; ${result.unconfirmed} commands could not be confirmed. Refresh and start the remaining draft rows.`,
      );
  }, 'Eligible account rows queued.');
  const busy = action.isPending || startAll.isPending;
  const remove = useCommand(
    (task: Task) => workspaceService.deleteTask(task.id, task.revision),
    'Task deleted.',
  );
  const rows = data.tasks.filter(
    (t) =>
      (!batchId || t.batchId === batchId) &&
      (status === 'all' || t.status === status) &&
      `${t.name} ${t.id} ${t.workflow}`.toLowerCase().includes(debounced.toLowerCase()),
  );
  if (batchId) rows.sort((a, b) => (a.batchIndex ?? 0) - (b.batchIndex ?? 0));
  const startable = rows.filter((task) => task.allowedActions.includes('start'));
  const batches = new Map(
    data.tasks
      .filter((task) => task.batchId)
      .map((task) => [task.batchId!, task.batchName ?? task.name]),
  );
  const columns: Column<Task>[] = [
    {
      key: 'name',
      label: 'Task',
      sortValue: (t) => t.name,
      render: (t) => (
        <div className="cell-title">
          <strong>{t.name}</strong>
          {t.batchId && (
            <span>
              Account row {t.batchIndex} / {t.batchSize}
            </span>
          )}
          <span>
            {t.id} <span className="separator">/</span> {t.workflow}
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (t) => (
        <div className="task-status-detail">
          <Badge value={t.status} />
          {t.lastErrorCode && (
            <span className="task-error">
              <strong>{t.lastErrorCode}</strong>
              <span>{t.lastErrorMessage}</span>
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'progress',
      label: 'Progress',
      render: (t) => (
        <div className="progress-cell">
          <div>
            <span>
              {t.completed}
              <span className="muted"> / {t.total}</span>
            </span>
            <span>{t.progress}%</span>
          </div>
          <progress value={t.progress} max={100} aria-label={`${t.name} progress`} />
        </div>
      ),
    },
    { key: 'proxy', label: 'Proxy', render: (t) => <span className="small-text">{t.proxy}</span> },
    {
      key: 'duration',
      label: 'Elapsed',
      render: (t) => <span className="mono">{t.duration}</span>,
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (t) => (
        <div className="row-actions">
          {t.allowedActions.map((a) => (
            <Button
              key={a}
              size={a === 'retry' ? 'sm' : 'icon'}
              variant={a === 'retry' ? 'outline' : 'ghost'}
              disabled={busy}
              title={
                a === 'retry'
                  ? 'Retry failed task'
                  : a === 'resume'
                    ? 'Resume task'
                    : a === 'pause'
                      ? 'Pause task'
                      : 'Start task'
              }
              aria-label={`${a} ${t.name}`}
              onClick={() => action.mutate({ task: t, action: a })}
            >
              {a === 'retry' ? (
                <>
                  <RotateCcw size={15} />
                  Retry
                </>
              ) : a === 'pause' ? (
                <Pause size={15} />
              ) : (
                <Play size={15} />
              )}
            </Button>
          ))}
          {['failed', 'blocked', 'needs_reconciliation'].includes(t.status) &&
            !t.allowedActions.includes('retry') && (
              <Button
                size="sm"
                variant="outline"
                disabled
                title={
                  t.businessOutcome === 'UNKNOWN' || t.businessOutcome === 'CREATED'
                    ? 'Retry disabled: review the external account result first.'
                    : 'This error is not safe to retry. Resolve the configuration first.'
                }
              >
                <RotateCcw size={15} />
                Retry
              </Button>
            )}
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Edit ${t.name}`}
            disabled={busy || ['running', 'success', 'needs_reconciliation'].includes(t.status)}
            onClick={() => onEdit(t)}
          >
            <Pencil size={15} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Delete ${t.name}`}
            disabled={busy || t.status === 'running' || t.status === 'needs_reconciliation'}
            onClick={() => setDeleting(t)}
          >
            <Trash2 size={15} />
          </Button>
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Tasks"
        description="One account per task row. Queue an entire batch or run rows individually."
        actions={
          <>
            <Button
              disabled={busy || startable.length === 0}
              title="Start all draft rows matching the current batch and filters"
              onClick={() => startAll.mutate(startable)}
            >
              <Play size={16} />
              {startAll.isPending ? 'Starting...' : `Start all (${startable.length})`}
            </Button>
            <Button variant="default" onClick={onCreate} disabled={busy}>
              <Plus size={16} />
              Create task
            </Button>
          </>
        }
      />
      <div className="panel">
        <div className="table-toolbar">
          <div className="toolbar-left">
            <SearchInput value={search} onChange={setSearch} placeholder="Search tasks..." />
            <Select
              aria-label="Filter task batch"
              value={batchId ?? ''}
              onChange={(event) => selectBatch(event.target.value || undefined)}
            >
              <option value="">All batches</option>
              {[...batches].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
            <ListFilter size={15} className="muted" />
            <Select
              aria-label="Filter task status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All statuses</option>
              {[
                'draft',
                'pending',
                'running',
                'paused',
                'success',
                'failed',
                'blocked',
                'needs_reconciliation',
              ].map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1).replaceAll('_', ' ')}
                </option>
              ))}
            </Select>
          </div>
          <span className="muted small-text">{rows.length} tasks</span>
        </div>
        <DataTable rows={rows} columns={columns} label="Automation tasks" pageSize={25} />
      </div>
      <p className="page-footnote">
        Each row creates one account. Start all queues matching draft rows; worker and browser
        capacity determine how many run at once.
      </p>
      <ConfirmDialog
        open={!!deleting}
        title="Delete task?"
        description={`Remove ?${deleting?.name}? from this workspace. Running tasks must be paused first.`}
        pending={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting && remove.mutate(deleting, { onSuccess: () => setDeleting(null) })
        }
      />
    </>
  );
}
