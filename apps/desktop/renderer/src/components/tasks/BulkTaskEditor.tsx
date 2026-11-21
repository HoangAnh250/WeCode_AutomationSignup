import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/shared/Field';
import type { Task, TaskInput, WorkspaceData } from '@/types/domain';
export type TaskBulkPatch = Partial<Pick<TaskInput, 'proxy' | 'showBrowser' | 'profile'>> & {
  namePrefix?: string;
};
export function BulkTaskEditor({
  tasks,
  skipped,
  data,
  pending,
  progress,
  onClose,
  onSave,
}: {
  tasks: Task[];
  skipped: number;
  data: WorkspaceData;
  pending: boolean;
  progress: string;
  onClose: () => void;
  onSave: (patch: TaskBulkPatch) => void;
}) {
  const [proxy, setProxy] = useState('');
  const [browser, setBrowser] = useState('');
  const [profile, setProfile] = useState('');
  const [namePrefix, setNamePrefix] = useState('');
  return (
    <Dialog
      open
      title="Edit selected tasks"
      description={`${tasks.length} eligible tasks. ${skipped} queued, running or uncertain tasks will be skipped. Existing accounts and execution history are preserved.`}
      onOpenChange={(open) => !open && !pending && onClose()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            ...(proxy ? { proxy } : {}),
            ...(browser ? { showBrowser: browser === 'show' } : {}),
            ...(profile ? { profile } : {}),
            ...(namePrefix.trim() ? { namePrefix: namePrefix.trim() } : {}),
          });
        }}
      >
        <div className="form-stack">
          <Field
            label="Task name prefix"
            hint="Leave blank to keep names. A prefix renames rows as Prefix [01/N]."
          >
            {(id) => (
              <Input
                id={id}
                maxLength={100}
                value={namePrefix}
                disabled={pending}
                onChange={(e) => setNamePrefix(e.target.value)}
              />
            )}
          </Field>
          <Field label="Proxy">
            {(id) => (
              <Select
                id={id}
                value={proxy}
                disabled={pending}
                onChange={(e) => setProxy(e.target.value)}
              >
                <option value="">Keep each task's proxy</option>
                <option>Local (no proxy)</option>
                <option>Auto assign</option>
                {data.proxies.map((p) => (
                  <option key={p.id} value={`${p.host}:${p.port}`}>
                    {p.host}:{p.port}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Browser visibility">
            {(id) => (
              <Select
                id={id}
                value={browser}
                disabled={pending}
                onChange={(e) => setBrowser(e.target.value)}
              >
                <option value="">Keep each task's setting</option>
                <option value="show">Show browser</option>
                <option value="hide">Hide browser</option>
              </Select>
            )}
          </Field>
          <Field label="Browser profile" hint="Auto assign gives each task an independent profile.">
            {(id) => (
              <Select
                id={id}
                value={profile}
                disabled={pending}
                onChange={(e) => setProfile(e.target.value)}
              >
                <option value="">Keep each task's profile</option>
                <option>Auto assign</option>
              </Select>
            )}
          </Field>
          {pending && <p role="status">{progress}</p>}
        </div>
        <div className="dialog-footer">
          <Button type="button" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="default"
            disabled={
              pending || !tasks.length || !(proxy || browser || profile || namePrefix.trim())
            }
          >
            {pending ? 'Saving...' : `Save ${tasks.length} tasks`}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
