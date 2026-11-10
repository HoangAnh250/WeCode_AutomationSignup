import { Dialog } from '@/components/ui/dialog';
import type { LogEntry } from '@/types/domain';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ArrowDownToLine, Radio, Terminal, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { keys } from '@/hooks/useWorkspace';
import { workspaceService } from '@/services/workspace-service';
import { useLogView } from '@/stores/log-view.store';
import { formatTime } from '@/lib/utils';
import { client } from '@/ipc/client';
import { useCommand } from '@/hooks/useWorkspace';
export function LogsPage() {
  const {
    data: logs = [],
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: keys.logs,
    queryFn: workspaceService.logs,
    retry: false,
    staleTime: 10000,
  });
  const view = useLogView();
  const viewport = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState<LogEntry | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(480);
  const rows = logs.filter(
    (l) =>
      (view.level === 'all' || l.level === view.level) &&
      (view.category === 'all' || l.category === view.category) &&
      `${l.message} ${l.taskId ?? ''}`.toLowerCase().includes(view.search.toLowerCase()),
  );
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (view.following && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [logs.length, view.following, view.search, view.level, view.category]);
  const exportLogs = useCommand((ids: string[]) => client.exportLogs(ids), 'Log export requested.');
  const start = Math.max(0, Math.floor(scrollTop / 44) - 5);
  const end = Math.min(rows.length, start + Math.ceil(height / 44) + 12);
  return (
    <>
      <PageHeader
        title="Logs"
        description="Inspect browser activity, network events, and workflow execution."
        actions={
          <Button
            disabled={!rows.length || exportLogs.isPending}
            onClick={() => exportLogs.mutate(rows.map((l) => l.id))}
          >
            <Download size={16} />
            Export logs
          </Button>
        }
      />
      <section className="panel log-panel">
        <div className="table-toolbar">
          <div className="toolbar-left">
            <SearchInput
              value={view.search}
              onChange={view.setSearch}
              placeholder="Search log messages..."
            />
            <Select
              aria-label="Log level"
              value={view.level}
              onChange={(e) => view.setLevel(e.target.value)}
            >
              <option value="all">All levels</option>
              {['info', 'success', 'warn', 'error'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
            <Select
              aria-label="Log category"
              value={view.category}
              onChange={(e) => view.setCategory(e.target.value)}
            >
              <option value="all">All events</option>
              {['task', 'browser', 'network', 'queue', 'system'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </div>
          <Button
            variant={view.following ? 'outline' : 'ghost'}
            size="sm"
            onClick={view.toggleFollowing}
          >
            <ArrowDownToLine size={14} />
            Auto-scroll {view.following ? 'on' : 'off'}
          </Button>
        </div>
        <div className="log-subheading">
          <span>
            <Radio size={13} />
            {client.mode === 'preview' ? 'Preview event stream' : 'Desktop event stream'}
          </span>
          <span>{rows.length} events / latest 500 retained</span>
        </div>
        {error ? (
          <div className="empty-state">
            <h3>Log stream unavailable</h3>
            <p>{error.message}</p>
            <Button onClick={() => void refetch()}>
              <RefreshCw size={14} />
              Retry
            </Button>
          </div>
        ) : isPending ? (
          <div className="empty-state">Loading event history?</div>
        ) : (
          <div
            className="log-viewport"
            ref={viewport}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            role="region"
            aria-label="Live log messages"
            tabIndex={0}
          >
            {rows.length ? (
              <div role="list" style={{ height: rows.length * 44, position: 'relative' }}>
                {rows.slice(start, end).map((l, i) => (
                  <div
                    role="listitem"
                    className="log-line"
                    key={l.id}
                    style={{
                      position: 'absolute',
                      top: (start + i) * 44,
                      left: 0,
                      right: 0,
                      height: 44,
                    }}
                    title={`${l.timestamp} [${l.category}] ${l.message}`}
                  >
                    <time>{formatTime(l.timestamp)}</time>
                    <span className={`log-level ${l.level}`}>{l.level}</span>
                    <span className="log-category">{l.category}</span>
                    <button
                      type="button"
                      className="log-message log-open"
                      onClick={() => setDetails(l)}
                    >
                      {l.message}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No matching events"
                description="Change the search or event filters."
              />
            )}
          </div>
        )}
        <div className="panel-bottom">
          <Terminal size={13} />
          <span>Structured events / credentials redacted by the event producer</span>
          <span className="spacer" />
          <span>UTF-8</span>
        </div>
      </section>
      <Dialog
        open={Boolean(details)}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
        title="Log event details"
        description="Full diagnostic message for this event."
      >
        {details && (
          <div className="form-stack">
            <p className="log-detail-message">{details.message}</p>
            <p className="small-text muted">
              {details.timestamp} / {details.level} / {details.category}
            </p>
            {details.taskId && <p className="mono small-text">Task: {details.taskId}</p>}
          </div>
        )}
      </Dialog>
    </>
  );
}
