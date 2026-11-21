import { useState } from 'react';
import { Plus, Play, Pause, Pencil, Trash2, ListFilter, RotateCcw } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { SearchInput } from '@/components/shared/SearchInput';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { useCommand } from '@/hooks/useWorkspace';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useWorkbench } from '@/stores/workbench.store';
import { BulkTaskEditor, type TaskBulkPatch } from '@/components/tasks/BulkTaskEditor';
import { canEditTask, canDeleteTask, taskRange } from '@/lib/task-selection';
import { useNotifications } from '@/stores/notification.store';
import { applyToTasks, workspaceService } from '@/services/workspace-service';
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
  const [deleting, setDeleting] = useState<{
    tasks: Task[];
    skipped: number;
    all?: boolean;
  } | null>(null);
  const [editing, setEditing] = useState<{ tasks: Task[]; skipped: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('10');
  const [report, setReport] = useState('');
  const [progress, setProgress] = useState('');
  const notify = useNotifications((state) => state.push);
  const finish = (
    verb: string,
    result: Awaited<ReturnType<typeof applyToTasks>>,
    skipped: number,
  ) => {
    const text = `${verb}: ${result.succeeded.length} confirmed, ${result.failed.length} not confirmed, ${skipped} skipped.`;
    setReport(
      text +
        (result.failed.length
          ? ` Refresh before retrying. ${result.failed
              .slice(0, 3)
              .map((failure) => `${failure.name}: ${failure.message}`)
              .join(' / ')}`
          : ''),
    );
    notify(text, result.failed.length ? 'error' : undefined);
    setSelected((old) => new Set([...old].filter((id) => !result.succeeded.includes(id))));
  };
  const trackProgress = (done: number, total: number) =>
    setProgress(`${done} / ${total} tasks processed`);
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
  const remove = useCommand(async (selection: NonNullable<typeof deleting>) => {
    const result = await applyToTasks(
      selection.tasks,
      (task) => workspaceService.deleteTask(task.id, task.revision),
      trackProgress,
    );
    finish('Delete', result, selection.skipped);
    setDeleting(null);
  });
  const editMany = useCommand(async (patch: TaskBulkPatch) => {
    if (!editing) return;
    let index = 0;
    const result = await applyToTasks(
      editing.tasks,
      (task) => {
        const number = ++index;
        const { namePrefix, ...fields } = patch;
        return workspaceService.updateTask(
          task.id,
          {
            name: namePrefix
              ? `${namePrefix} [${String(number).padStart(String(editing.tasks.length).length, '0')}/${editing.tasks.length}]`
              : task.name,
            preserveIdentity: true,
            workflow: task.workflow,
            total: 1,
            proxy: task.proxy,
            profile: task.profile,
            showBrowser: task.showBrowser,
            ...fields,
          },
          task.revision,
        );
      },
      trackProgress,
    );
    finish('Edit', result, editing.skipped);
    setEditing(null);
  });
  const busy = action.isPending || startAll.isPending || remove.isPending || editMany.isPending;
  const rows = data.tasks.filter(
    (t) =>
      (!batchId || t.batchId === batchId) &&
      (status === 'all' || t.status === status) &&
      `${t.name} ${t.id} ${t.workflow}`.toLowerCase().includes(debounced.toLowerCase()),
  );
  if (batchId) rows.sort((a, b) => (a.batchIndex ?? 0) - (b.batchIndex ?? 0));
  const startable = rows.filter(
    (task) => task.status === 'draft' && task.allowedActions.includes('start'),
  );
  const selectedRows = rows.filter((task) => selected.has(task.id));
  const toggle = (id: string) =>
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const requestDelete = (tasks: Task[], all = false) => {
    const eligible = tasks.filter(canDeleteTask);
    setProgress('');
    setDeleting({ tasks: eligible, skipped: tasks.length - eligible.length, all });
  };
  const batches = new Map(
    data.tasks
      .filter((task) => task.batchId)
      .map((task) => [task.batchId!, task.batchName ?? task.name]),
  );
  const columns: Column<Task>[] = [
    {
      key: 'select',
      label: (
        <input
          type="checkbox"
          aria-label="Select all filtered tasks"
          disabled={busy || !rows.length}
          checked={rows.length > 0 && selectedRows.length === rows.length}
          ref={(node) => {
            if (node)
              node.indeterminate = selectedRows.length > 0 && selectedRows.length < rows.length;
          }}
          onChange={(event) =>
            setSelected(new Set(event.target.checked ? rows.map((task) => task.id) : []))
          }
        />
      ),
      render: (task) => (
        <input
          type="checkbox"
          aria-label={`Select ${task.name}`}
          checked={selected.has(task.id)}
          disabled={busy}
          onChange={() => toggle(task.id)}
        />
      ),
    },
    {
      key: 'number',
      label: '#',
      render: (task) => <span className="mono">{rows.indexOf(task) + 1}</span>,
    },
    {
      key: 'name',
      label: 'Task',
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
    {
      key: 'proxy',
      label: 'Proxy',
      render: (t) => (
        <span className="small-text">
          {t.assignedProxy ? `${t.assignedProxy} (Auto)` : t.proxy}
        </span>
      ),
    },
    {
      key: 'duration',
      label: 'Elapsed',
      render: (t) => <span className="mono">{t.duration}</span>,
    },
    {
      key: 'actions',
      label: 'Actions',
      className: 'task-actions-column',
      render: (t) => (
        <div className="row-actions">
          {t.allowedActions.map((a) => (
            <Button
              key={a}
              size={a === 'retry' || (a === 'start' && t.status === 'success') ? 'sm' : 'icon'}
              variant={a === 'retry' ? 'outline' : 'ghost'}
              disabled={busy}
              title={
                a === 'retry'
                  ? 'Retry failed task'
                  : a === 'resume'
                    ? 'Resume task'
                    : a === 'pause'
                      ? 'Pause task'
                      : t.status === 'success'
                        ? 'Create a new account with this task'
                        : 'Start task'
              }
              aria-label={`${a} ${t.name}`}
              onClick={() => action.mutate({ task: t, action: a })}
            >
              {a === 'start' && t.status === 'success' ? (
                <>
                  <Play size={15} />
                  Start again
                </>
              ) : a === 'retry' ? (
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
            disabled={busy || !canEditTask(t)}
            onClick={() => onEdit(t)}
          >
            <Pencil size={15} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Delete ${t.name}`}
            disabled={busy || !canDeleteTask(t)}
            onClick={() => requestDelete([t])}
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
              variant="destructive"
              disabled={busy || !data.tasks.length}
              onClick={() => requestDelete(data.tasks, true)}
            >
              <Trash2 size={16} />
              Delete all tasks
            </Button>
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
        <div className="task-selection-toolbar">
          <div className="task-range-controls">
            <label>
              From row{' '}
              <Input
                aria-label="From row"
                type="number"
                min={1}
                max={rows.length}
                value={from}
                disabled={busy}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              To row{' '}
              <Input
                aria-label="To row"
                type="number"
                min={1}
                max={rows.length}
                value={to}
                disabled={busy}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <Button
              disabled={busy || !rows.length}
              onClick={() => {
                try {
                  setSelected(new Set(taskRange(rows, Number(from), Number(to))));
                  setReport('');
                } catch (error) {
                  setReport((error as Error).message);
                }
              }}
            >
              Select range
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !selectedRows.length}
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </Button>
          </div>
          <div className="row-actions">
            <span role="status">{selectedRows.length} selected</span>
            <Button
              disabled={busy || !selectedRows.some(canEditTask)}
              onClick={() => {
                setProgress('');
                const eligible = selectedRows.filter(canEditTask);
                setEditing({ tasks: eligible, skipped: selectedRows.length - eligible.length });
              }}
            >
              <Pencil size={15} />
              Edit selected
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !selectedRows.some(canDeleteTask)}
              onClick={() => requestDelete(selectedRows)}
            >
              <Trash2 size={15} />
              Delete selected
            </Button>
          </div>
        </div>
        <p className="task-selection-hint">
          Range uses the numbered, filtered list across all pages. Hidden rows are not included in
          selected actions.
        </p>
        {report && (
          <p className="task-bulk-report" role="status">
            {report}
          </p>
        )}
        <DataTable rows={rows} columns={columns} label="Automation tasks" pageSize={25} />
      </div>
      <p className="page-footnote">
        Each row creates one account. Start all queues matching draft rows; worker and browser
        capacity determine how many run at once. Start again on a successful row creates a new
        account with a clean browser profile and keeps previous accounts in history.
      </p>
      {editing && (
        <BulkTaskEditor
          tasks={editing.tasks}
          skipped={editing.skipped}
          data={data}
          pending={editMany.isPending}
          progress={progress}
          onClose={() => setEditing(null)}
          onSave={(patch) => editMany.mutate(patch)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={
          deleting?.all
            ? 'Delete all tasks?'
            : deleting?.tasks.length === 1
              ? 'Delete task?'
              : 'Delete selected tasks?'
        }
        description={`${deleting?.tasks.length ?? 0} eligible tasks will be removed${deleting?.all ? ' from the entire workspace, including filtered-out rows' : ''}. ${deleting?.skipped ?? 0} queued, running or uncertain tasks will be kept. Saved accounts and execution history are preserved.${remove.isPending ? ` ${progress}` : ''}`}
        pending={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </>
  );
}
