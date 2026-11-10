import { useRef, useState } from 'react';
import {
  Upload,
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
import type { Proxy, WorkspaceData } from '@/types/domain';
export function ProxiesPage({ data }: { data: WorkspaceData }) {
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
      `${p.host} ${p.country} ${p.protocol}`.toLowerCase().includes(search.toLowerCase()),
  );
  const columns: Column<Proxy>[] = [
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
      render: (p) => (
        <Button
          size="sm"
          variant="ghost"
          disabled={check.isPending}
          onClick={() => check.mutate(p.id)}
        >
          <RefreshCw size={14} />
          Check
        </Button>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Proxies"
        description="Manage connection pools and keep your workflows connected."
        actions={
          <Button variant="default" onClick={() => setOpen(true)}>
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
        <DataTable rows={rows} columns={columns} label="Proxy pool" />
      </div>
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
