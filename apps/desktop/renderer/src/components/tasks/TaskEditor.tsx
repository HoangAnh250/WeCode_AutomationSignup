import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/shared/Field';
import { useCommand } from '@/hooks/useWorkspace';
import { useWorkbench } from '@/stores/workbench.store';
import { workspaceService } from '@/services/workspace-service';
import type { Task, TaskInput, WorkspaceData } from '@/types/domain';
export function TaskEditor({
  task,
  data,
  onClose,
}: {
  task: Task | null;
  data: WorkspaceData;
  onClose: () => void;
}) {
  const [creationId] = useState(() => crypto.randomUUID());
  const selectBatch = useWorkbench((state) => state.selectTaskBatch);
  const navigate = useWorkbench((state) => state.navigate);
  const [input, setInput] = useState<TaskInput>({
    name: task?.name ?? '',
    workflow: task?.workflow ?? 'Weverse Signup',
    total: 1,
    showBrowser: task?.showBrowser ?? true,
    proxy: task?.proxy ?? 'Local (no proxy)',
    profile: task?.profile ?? 'Auto assign',
  });
  const [error, setError] = useState('');
  const command = useCommand(
    async (value: TaskInput) =>
      task
        ? workspaceService.updateTask(task.id, value, task.revision)
        : workspaceService.createTask(value),
    task ? 'Task updated.' : 'Account task rows created.',
  );
  const field = <K extends keyof TaskInput>(key: K, value: TaskInput[K]) =>
    setInput((s) => ({ ...s, [key]: value }));
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !command.isPending && onClose()}
      title={task ? 'Edit task' : 'Create task'}
      description="Each account gets its own task row and isolated browser profile."
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!input.name.trim()) {
            setError('Enter a task name.');
            return;
          }
          if (!Number.isInteger(input.total) || input.total < 1 || input.total > 1000) {
            setError('Batch size must be between 1 and 1,000.');
            return;
          }
          try {
            await command.mutateAsync({
              ...input,
              name: input.name.trim(),
              creationId: task ? undefined : creationId,
            });
            if (!task) {
              selectBatch(input.total > 1 ? creationId : undefined);
              navigate('tasks');
            }
            onClose();
          } catch {
            /* surfaced by command notification */
          }
        }}
      >
        <div className="form-stack">
          <Field label="Task name">
            {(id) => (
              <Input
                id={id}
                autoFocus
                maxLength={100}
                value={input.name}
                onChange={(e) => field('name', e.target.value)}
                placeholder="e.g. Weekly account onboarding"
              />
            )}
          </Field>
          <div className="form-grid">
            <Field label="Workflow">
              {(id) => (
                <Select
                  id={id}
                  value={input.workflow}
                  onChange={(e) => field('workflow', e.target.value)}
                >
                  <option value="Weverse Signup">Create Account (Weverse)</option>
                </Select>
              )}
            </Field>
            <Field
              label={task ? 'Accounts per row' : 'Batch size'}
              hint={
                task
                  ? 'One account per row. Create a new batch to add more rows.'
                  : `${input.total} account${input.total === 1 ? '' : 's'} = ${input.total} separate task row${input.total === 1 ? '' : 's'}.`
              }
            >
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={task ? 1 : 1000}
                  disabled={!!task}
                  value={input.total}
                  onChange={(e) =>
                    setInput((current) => ({
                      ...current,
                      total: Number(e.target.value),
                      profile: Number(e.target.value) > 1 ? 'Auto assign' : current.profile,
                    }))
                  }
                />
              )}
            </Field>
            <Field
              label="Proxy assignment"
              hint="Local uses this computer's connection without assigning a proxy. Auto assign selects from the proxy pool."
            >
              {(id) => (
                <Select
                  id={id}
                  value={input.proxy}
                  onChange={(e) => field('proxy', e.target.value)}
                >
                  <option>Local (no proxy)</option>
                  <option>Auto assign</option>
                  {[
                    ...new Set(
                      [task?.proxy, ...data.proxies.map((p) => `${p.host}:${p.port}`)].filter(
                        (value) =>
                          Boolean(value) && value !== 'Auto assign' && value !== 'Local (no proxy)',
                      ),
                    ),
                  ].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Browser profile">
              {(id) => (
                <Select
                  id={id}
                  value={input.profile}
                  disabled={!task && input.total > 1}
                  onChange={(e) => field('profile', e.target.value)}
                >
                  <option>Auto assign</option>
                  {data.profiles.map((p) => (
                    <option key={p.id}>{p.name}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="checkbox-grid">
            <label>
              <input
                type="checkbox"
                checked={input.showBrowser ?? true}
                onChange={(event) => field('showBrowser', event.target.checked)}
              />
              Show browser while running
            </label>
          </div>
          <p className="small-text muted">
            Visible browsers let you watch the signup steps. Block Overseas Logins is always turned
            off before submission.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="inline-note">
            Each row creates one account. Batch rows use separate Auto assign profiles. Use Start
            all to queue the batch; worker and browser capacity control how many run at once.
          </div>
        </div>
        <div className="dialog-footer">
          <Button onClick={onClose} disabled={command.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="default" disabled={command.isPending}>
            {command.isPending ? 'Saving...' : task ? 'Save changes' : 'Create task'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
