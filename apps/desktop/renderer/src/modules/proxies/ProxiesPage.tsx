import { useRef, useState } from 'react';
import {
  Upload,
  Pencil,
  Trash2,
  ShieldCheck,
  Globe,
  Activity,
  RefreshCw,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/input';
import { parseProxies, type ImportPreview } from '@/lib/proxy-parser';
import { client } from '@/ipc/client';
import { useCommand } from '@/hooks/useWorkspace';
import { ProxyEditor } from '@/components/proxies/ProxyEditor';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useNotifications } from '@/stores/notification.store';
import type { Proxy, ProxyEditInput, WorkspaceData } from '@/types/domain';
export function ProxiesPage({ data }: { data: WorkspaceData }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Proxy[] | null>(null);
  const [deleting, setDeleting] = useState<{ rows: Proxy[]; skipped: number } | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [progress, setProgress] = useState('');
  const [report, setReport] = useState('');
  const notify = useNotifications((state) => state.push);
  const runBatch = async (
    proxies: Proxy[],
    operation: (proxy: Proxy) => Promise<void>,
    verb: string,
    skipped = 0,
  ) => {
    const succeeded: string[] = [];
    const failed: string[] = [];
    for (const proxy of proxies) {
      try {
        await operation(proxy);
        succeeded.push(proxy.id);
      } catch (error) {
        failed.push(
          `${proxy.host}:${proxy.port}: ${error instanceof Error ? error.message : 'Command could not be confirmed.'}`,
        );
      }
      setProgress(`${succeeded.length + failed.length} / ${proxies.length} processed`);
    }
    const summary = `${verb}: ${succeeded.length} confirmed, ${failed.length} not confirmed, ${skipped} in-use proxies skipped.`;
    setReport(
      summary +
        (failed.length ? ` Refresh before retrying. ${failed.slice(0, 3).join(' / ')}` : ''),
    );
    notify(summary, failed.length ? 'error' : undefined);
    setSelected((old) => new Set([...old].filter((id) => !succeeded.includes(id))));
  };
  const editCommand = useCommand(async (input: ProxyEditInput) => {
    if (!editing) return;
    await runBatch(
      editing,
      (proxy) => client.updateProxy(proxy.id, input, proxy.revision ?? 1),
      'Edit',
    );
    setEditing(null);
  });
  const deleteCommand = useCommand(async () => {
    if (!deleting) return;
    await runBatch(
      deleting.rows,
      (proxy) => client.deleteProxy(proxy.id, proxy.revision ?? 1),
      'Delete',
      deleting.skipped,
    );
    setDeleting(null);
  });
  const [search, setSearch] = useState('');
  const [health, setHealth] = useState('all');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [format, setFormat] = useState<'txt' | 'json'>('txt');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const check = useCommand((id: string) => client.checkProxy(id), 'Health check requested.');
  const upload = useCommand(async () => {
    if (!preview?.valid.length) throw new Error('Validate at least one proxy first.');
    return client.importProxies(preview.valid);
  });
  const reset = () => {
    setOpen(false);
    setText('');
    setPreview(null);
    setError('');
  };
  const rows = data.proxies.filter(
    (p) =>
      (health === 'all' || p.health === health) &&
      `${p.host}:${p.port} ${p.country} ${p.protocol}`.toLowerCase().includes(search.toLowerCase()),
  );
  const selectedRows = rows.filter((proxy) => selected.has(proxy.id));
  const editable = selectedRows.filter((proxy) => !proxy.assigned);
  const busy =
    editCommand.isPending || deleteCommand.isPending || upload.isPending || check.isPending;
  const requestDelete = (proxies: Proxy[]) => {
    setProgress('');
    setDeleting({
      rows: proxies.filter((proxy) => !proxy.assigned),
      skipped: proxies.filter((proxy) => proxy.assigned).length,
    });
  };
  const columns: Column<Proxy>[] = [
    {
      key: 'select',
      label: (
        <input
          type="checkbox"
          aria-label="Select all filtered proxies"
          checked={!!rows.length && selectedRows.length === rows.length}
          disabled={busy || !rows.length}
          ref={(node) => {
            if (node)
              node.indeterminate = selectedRows.length > 0 && selectedRows.length < rows.length;
          }}
          onChange={(event) =>
            setSelected(new Set(event.target.checked ? rows.map((proxy) => proxy.id) : []))
          }
        />
      ),
      render: (proxy) => (
        <input
          type="checkbox"
          aria-label={`Select ${proxy.host}:${proxy.port}`}
          checked={selected.has(proxy.id)}
          disabled={busy}
          onChange={() =>
            setSelected((old) => {
              const next = new Set(old);
              if (next.has(proxy.id)) next.delete(proxy.id);
              else next.add(proxy.id);
              return next;
            })
          }
        />
      ),
    },
    {
      key: 'index',
      label: '#',
      render: (_proxy, index) => <span className="mono">{index + 1}</span>,
    },
    {
      key: 'endpoint',
      label: 'Endpoint',
      sortValue: (p) => p.host,
      render: (p) => (
        <div className="cell-title">
          <strong className="mono">
            {p.host}:{p.port}
          </strong>
          <span>
            {p.id.slice(0, 12)}
            {p.hasCredentials ? ' / Authenticated' : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'protocol',
      label: 'Protocol',
      render: (p) => <span className="protocol">{p.protocol.toUpperCase()}</span>,
    },
    {
      key: 'country',
      label: 'Location',
      render: (p) => (
        <span className="location-cell">
          <Globe size={14} />
          {p.country}
        </span>
      ),
    },
    { key: 'health', label: 'Health', render: (p) => <Badge value={p.health} /> },
    {
      key: 'latency',
      label: 'Latency',
      sortValue: (p) => p.latency ?? 99999,
      render: (p) => <span className="mono">{p.latency === null ? '-' : `${p.latency} ms`}</span>,
    },
    { key: 'usage', label: 'Usage', render: (p) => <span>{p.assigned} active</span> },
    {
      key: 'actions',
      label: 'Actions',
      className: 'task-actions-column',
      render: (proxy) => (
        <div className="row-actions">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => check.mutate(proxy.id)}>
            <RefreshCw size={14} />
            Check
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Edit ${proxy.host}:${proxy.port}`}
            title={proxy.assigned ? 'Proxy is in use' : 'Edit proxy'}
            disabled={busy || proxy.assigned > 0}
            onClick={() => {
              setProgress('');
              setEditing([proxy]);
            }}
          >
            <Pencil size={15} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Delete ${proxy.host}:${proxy.port}`}
            title={proxy.assigned ? 'Proxy is in use' : 'Delete proxy'}
            disabled={busy || proxy.assigned > 0}
            onClick={() => requestDelete([proxy])}
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
        title="Proxies"
        description="Manage connection pools and keep your workflows connected."
        actions={
          <Button variant="default" disabled={busy} onClick={() => setOpen(true)}>
            <Upload size={16} />
            Import proxies
          </Button>
        }
      />
      <div className="mini-stats">
        {[
          { label: 'Total proxies', value: data.proxies.length, icon: Globe },
          {
            label: 'Healthy',
            value: data.proxies.filter((p) => p.health === 'healthy').length,
            icon: ShieldCheck,
          },
          {
            label: 'In use',
            value: data.proxies.filter((p) => p.assigned > 0).length,
            icon: Activity,
          },
        ].map((s) => (
          <div className="mini-stat" key={s.label}>
            <s.icon size={19} />
            <span>{s.label}</span>
            <strong>{s.value}</strong>
          </div>
        ))}
      </div>
      <div className="panel">
        <div className="table-toolbar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search endpoint or location..."
          />
          <Select
            aria-label="Proxy health filter"
            value={health}
            onChange={(e) => setHealth(e.target.value)}
          >
            <option value="all">All health statuses</option>
            <option value="healthy">Healthy</option>
            <option value="unknown">Unchecked</option>
            <option value="unreachable">Unavailable</option>
          </Select>
        </div>
        <div className="task-selection-toolbar">
          <div className="row-actions">
            <span role="status">{selectedRows.length} selected</span>
            <Button
              disabled={busy || !selectedRows.length}
              variant="ghost"
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </Button>
            <Button
              disabled={busy || !editable.length}
              onClick={() => {
                setProgress('');
                setEditing(editable);
              }}
            >
              <Pencil size={15} />
              Edit selected
            </Button>
            <Button
              disabled={busy || !editable.length}
              variant="destructive"
              onClick={() => requestDelete(selectedRows)}
            >
              <Trash2 size={15} />
              Delete selected
            </Button>
          </div>
          <label className="proxy-page-size">
            Rows per page{' '}
            <Select
              aria-label="Proxies per page"
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <p className="task-selection-hint">
          Select all applies to the filtered list across pages. In-use proxies are skipped; queued
          or saved bindings are checked before changes.
        </p>
        {report && (
          <p role="status" className="task-bulk-report">
            {report}
          </p>
        )}
        <DataTable
          key={`${search}:${health}:${pageSize}`}
          rows={rows}
          columns={columns}
          label="Proxy pool"
          pageSize={pageSize}
          numberedPages
        />
      </div>
      {editing && (
        <ProxyEditor
          proxies={editing}
          pending={editCommand.isPending}
          progress={progress}
          onClose={() => setEditing(null)}
          onSave={(input) => editCommand.mutateAsync(input).then(() => {})}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={deleting?.rows.length === 1 ? 'Delete proxy?' : 'Delete selected proxies?'}
        description={`${deleting?.rows.length ?? 0} proxies will be removed from the pool. ${deleting?.skipped ?? 0} in-use proxies will be kept. Account and usage history are preserved. ${deleteCommand.isPending ? progress : ''}`}
        pending={deleteCommand.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteCommand.mutate(undefined)}
      />
      <Dialog
        open={open}
        onOpenChange={(v) => !v && !upload.isPending && reset()}
        title="Import proxies"
        description="Upload JSON or TXT, or paste your proxy list."
      >
        <div className="form-stack">
          <div className="import-picker">
            <FileText size={24} />
            <div>
              <strong>Import from a file</strong>
              <p>JSON array or one proxy per line / up to 2 MB</p>
            </div>
            <Button onClick={() => file.current?.click()}>Choose file</Button>
            <input
              ref={file}
              type="file"
              accept=".json,.txt,application/json,text/plain"
              className="sr-only"
              aria-label="Proxy import file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setPreview(null);
                if (f.size > 2_000_000) {
                  setError('Choose a file smaller than 2 MB.');
                  return;
                }
                try {
                  setFormat(f.name.toLowerCase().endsWith('.json') ? 'json' : 'txt');
                  setText(await f.text());
                  setError('');
                } catch {
                  setError('Could not read this file. Choose it again.');
                }
                e.target.value = '';
              }}
            />
          </div>
          <div className="toolbar-left">
            <label htmlFor="proxy-format">Format</label>
            <Select
              id="proxy-format"
              value={format}
              onChange={(e) => {
                setFormat(e.target.value as 'json' | 'txt');
                setPreview(null);
              }}
            >
              <option value="txt">TXT / lines</option>
              <option value="json">JSON array</option>
            </Select>
          </div>
          <label htmlFor="proxy-text">Proxy entries</label>
          <textarea
            id="proxy-text"
            className="input code-input"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
            }}
            placeholder={
              format === 'txt'
                ? 'host:port\nhost:port:username:password\nsocks5://host:port'
                : '["host:port", {"host":"proxy.example","port":8080}]'
            }
          />
          <p className="field-hint">
            Supported: host:port, host:port:user:pass, http://, https:// and socks5://.
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {preview && (
            <div className="import-result">
              <strong>
                {preview.valid.length} valid ? {preview.invalid.length} invalid ?{' '}
                {preview.duplicates} duplicates
              </strong>
              {preview.invalid.slice(0, 4).map((x) => (
                <p key={x.line}>
                  <AlertTriangle size={13} />
                  Line {x.line}: {x.reason}
                </p>
              ))}
              <small>
                Only valid entries will be imported. Passwords are not shown in the preview.
              </small>
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <Button onClick={reset} disabled={upload.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              try {
                setPreview(parseProxies(text, format));
                setError('');
              } catch (e) {
                setPreview(null);
                setError(e instanceof Error ? e.message : 'Invalid import.');
              }
            }}
          >
            Validate list
          </Button>
          <Button
            variant="default"
            disabled={!preview?.valid.length || upload.isPending}
            onClick={() => upload.mutate(undefined, { onSuccess: reset })}
          >
            {upload.isPending ? 'Importing...' : 'Import valid proxies'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
