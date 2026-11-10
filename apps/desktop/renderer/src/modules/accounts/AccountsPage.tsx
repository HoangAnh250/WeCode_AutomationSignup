import { useState } from 'react';
import { Download, ShieldCheck, Users } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { useCommand } from '@/hooks/useWorkspace';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { client } from '@/ipc/client';
import type { Account, WorkspaceData } from '@/types/domain';
export function AccountsPage({ data }: { data: WorkspaceData }) {
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rows = data.accounts.filter(
    (a) =>
      (filter === 'all' || a.verification === filter) &&
      `${a.email} ${a.username}`.toLowerCase().includes(q.toLowerCase()),
  );
  const exportRows = useCommand(
    () =>
      client.exportAccounts(selected.size ? [...selected] : rows.map((a) => a.id), {
        includePasswords: true,
      }),
    'Account export requested.',
  );
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const columns: Column<Account>[] = [
    {
      key: 'select',
      label: (
        <input
          aria-label="Select all filtered accounts"
          type="checkbox"
          checked={rows.length > 0 && rows.every((a) => selected.has(a.id))}
          onChange={(e) =>
            setSelected((s) => {
              const n = new Set(s);
              rows.forEach((a) => (e.target.checked ? n.add(a.id) : n.delete(a.id)));
              return n;
            })
          }
        />
      ),
      render: (a) => (
        <input
          type="checkbox"
          aria-label={`Select ${a.email}`}
          checked={selected.has(a.id)}
          onChange={() => toggle(a.id)}
        />
      ),
    },
    {
      key: 'account',
      label: 'Account',
      sortValue: (a) => a.email,
      render: (a) => (
        <div className="account-cell">
          <span className="account-avatar">{a.username.slice(0, 2).toUpperCase()}</span>
          <div className="cell-title">
            <strong>{a.email}</strong>
            <span>{a.id}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'username',
      label: 'Username',
      render: (a) => <span className="mono small-text">{a.username}</span>,
    },
    { key: 'verification', label: 'Verification', render: (a) => <Badge value={a.verification} /> },
    {
      key: 'proxy',
      label: 'Proxy used',
      render: (a) => <span className="mono small-text">{a.proxy}</span>,
    },
    {
      key: 'created',
      label: 'Created',
      sortValue: (a) => a.createdAt,
      render: (a) => (
        <span>
          {new Date(a.createdAt).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })}
        </span>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Accounts"
        description="Verified account records from your automation workflows."
        actions={
          <Button
            variant="default"
            disabled={!rows.length || exportRows.isPending}
            onClick={() => exportRows.mutate(undefined)}
          >
            <Download size={16} />
            {exportRows.isPending
              ? 'Exporting...'
              : selected.size
                ? `Export ${selected.size} selected`
                : 'Export CSV'}
          </Button>
        }
      />
      <div className="mini-stats">
        <div className="mini-stat">
          <Users size={19} />
          <span>Total accounts</span>
          <strong>{data.accounts.length}</strong>
        </div>
        <div className="mini-stat">
          <ShieldCheck size={19} />
          <span>Verified</span>
          <strong>{data.accounts.filter((a) => a.verification === 'verified').length}</strong>
        </div>
      </div>
      <div className="panel">
        <div className="table-toolbar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search email or username..."
          />
          <div className="toolbar-left">
            {selected.size > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear {selected.size} selected
              </Button>
            )}
            <Select
              aria-label="Verification filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All verifications</option>
              <option value="verified">Verified</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </Select>
          </div>
        </div>
        <DataTable rows={rows} columns={columns} label="Stored accounts" />
      </div>
      <p className="page-footnote">
        <ShieldCheck size={14} />
        Exports include saved account passwords. Session tokens are not exported.
      </p>
    </>
  );
}
