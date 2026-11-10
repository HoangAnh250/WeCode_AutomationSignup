import { useState } from 'react';
import { Plus, Monitor, Globe, Clock3, Trash2, Layers } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/input';
import { SearchInput } from '@/components/shared/SearchInput';
import { Field } from '@/components/shared/Field';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { useCommand } from '@/hooks/useWorkspace';
import { client } from '@/ipc/client';
import type { Profile, WorkspaceData } from '@/types/domain';
export function ProfilesPage({ data }: { data: WorkspaceData }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [proxy, setProxy] = useState('Auto assign');
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const create = useCommand(async () => {
    if (!name.trim()) throw new Error('Enter a profile name.');
    await client.createProfile(name.trim(), proxy);
  }, 'Profile created.');
  const remove = useCommand((id: string) => client.deleteProfile(id), 'Profile deleted.');
  const rows = data.profiles.filter((p) =>
    `${p.name} ${p.proxy}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        title="Browser profiles"
        description="Isolated browser workspaces for consistent, persistent sessions."
        actions={
          <Button variant="default" onClick={() => setOpen(true)}>
            <Plus size={16} />
            Create profile
          </Button>
        }
      />
      <div className="section-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search profiles..." />
        <span className="muted">{rows.length} profiles</span>
      </div>
      <div className="profile-grid">
        {rows.map((p) => (
          <section className="panel profile-card" key={p.id}>
            <div className="profile-top">
              <span className="profile-avatar">
                <Monitor size={23} />
              </span>
              <Badge value={p.status} />
            </div>
            <h2>{p.name}</h2>
            <span className="muted mono small-text">{p.id.slice(0, 14)}</span>
            <div className="profile-details">
              <span>
                <Globe size={14} />
                {p.proxy}
              </span>
              <span>
                <Layers size={14} />
                {p.cookies} cookies in session
              </span>
              <span>
                <Clock3 size={14} />
                {new Date(p.lastActivity).toLocaleString()}
              </span>
            </div>
            <div className="profile-footer">
              <span>Chromium</span>
              <Button
                size="icon"
                variant="ghost"
                disabled={p.status === 'running'}
                aria-label={`Delete profile ${p.name}`}
                onClick={() => setDeleting(p)}
              >
                <Trash2 size={15} />
              </Button>
            </div>
          </section>
        ))}
      </div>
      {!rows.length && <EmptyState title="No profiles found" />}
      <Dialog
        open={open}
        onOpenChange={(v) => !v && !create.isPending && setOpen(false)}
        title="Create browser profile"
        description="Add an isolated workspace for your automation tasks."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(undefined, {
              onSuccess: () => {
                setOpen(false);
                setName('');
              },
            });
          }}
        >
          <div className="form-stack">
            <Field label="Profile name">
              {(id) => (
                <Input
                  id={id}
                  required
                  autoFocus
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Workspace 07"
                />
              )}
            </Field>
            <Field label="Assigned proxy">
              {(id) => (
                <Select id={id} value={proxy} onChange={(e) => setProxy(e.target.value)}>
                  <option>Auto assign</option>
                  {data.proxies.map((p) => (
                    <option key={p.id}>
                      {p.host}:{p.port}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="dialog-footer">
            <Button onClick={() => setOpen(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button variant="default" type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating...' : 'Create profile'}
            </Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        title="Delete browser profile?"
        description={`Remove ${deleting?.name} from this workspace. This action cannot be undone.`}
        pending={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
        }
      />
    </>
  );
}
