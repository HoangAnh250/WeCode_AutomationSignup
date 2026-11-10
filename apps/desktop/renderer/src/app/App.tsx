import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw, Unplug } from 'lucide-react';
import { Workbench } from '@/components/layout/Workbench';
import { TaskEditor } from '@/components/tasks/TaskEditor';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useDesktopEvents } from '@/hooks/useDesktopEvents';
import { useWorkbench } from '@/stores/workbench.store';
import type { Task } from '@/types/domain';
const Dashboard = lazy(() =>
  import('@/modules/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const Tasks = lazy(() =>
  import('@/modules/tasks/TasksPage').then((m) => ({ default: m.TasksPage })),
);
const Proxies = lazy(() =>
  import('@/modules/proxies/ProxiesPage').then((m) => ({ default: m.ProxiesPage })),
);
const Profiles = lazy(() =>
  import('@/modules/profiles/ProfilesPage').then((m) => ({ default: m.ProfilesPage })),
);
const Accounts = lazy(() =>
  import('@/modules/accounts/AccountsPage').then((m) => ({ default: m.AccountsPage })),
);
const Email = lazy(() =>
  import('@/modules/email/EmailPage').then((m) => ({ default: m.EmailPage })),
);
const Logs = lazy(() => import('@/modules/logs/LogsPage').then((m) => ({ default: m.LogsPage })));
const Settings = lazy(() =>
  import('@/modules/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="empty-state">
        <h2>This view could not be loaded</h2>
        <p>Reload the renderer to reconnect to your workspace.</p>
        <Button onClick={() => location.reload()}>Reload renderer</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
function Loading() {
  return (
    <div className="loading-shell" role="status" aria-label="Loading workspace">
      <div className="skeleton heading-skeleton" />
      <div className="stats-grid">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton stat-skeleton" />
        ))}
      </div>
      <div className="skeleton panel-skeleton" />
    </div>
  );
}
export function App() {
  const query = useWorkspace();
  useDesktopEvents();
  const page = useWorkbench((s) => s.page);
  const [editor, setEditor] = useState<{ task: Task | null } | null>(null);
  const previous = useRef(page);
  useEffect(() => {
    if (previous.current !== page) {
      document.querySelector<HTMLElement>('#main-content')?.focus();
      previous.current = page;
    }
  }, [page]);
  const create = () => setEditor({ task: null });
  const data = query.data;
  return (
    <Workbench data={data}>
      <ErrorBoundary>
        <Suspense fallback={<Loading />}>
          {query.isPending ? (
            <Loading />
          ) : query.error ? (
            <div className="service-error">
              <span className="service-error-icon">
                <Unplug size={32} />
              </span>
              <h1>Desktop services are unavailable</h1>
              <p>{query.error.message}</p>
              <Button onClick={() => void query.refetch()}>
                <RefreshCw size={16} />
                Retry connection
              </Button>
              <small>
                The frontend does not start browsers, connect to PostgreSQL, or read mailboxes
                directly.
              </small>
            </div>
          ) : data ? (
            <>
              {page === 'dashboard' && <Dashboard data={data} onCreate={create} />}{' '}
              {page === 'tasks' && (
                <Tasks data={data} onCreate={create} onEdit={(task) => setEditor({ task })} />
              )}{' '}
              {page === 'proxies' && <Proxies data={data} />}{' '}
              {page === 'profiles' && <Profiles data={data} />}{' '}
              {page === 'accounts' && <Accounts data={data} />}{' '}
              {page === 'email' && <Email data={data} />} {page === 'logs' && <Logs />}{' '}
              {page === 'settings' && <Settings data={data} />}{' '}
              {editor && (
                <TaskEditor
                  key={editor.task?.id ?? 'new'}
                  task={editor.task}
                  data={data}
                  onClose={() => setEditor(null)}
                />
              )}
            </>
          ) : null}
        </Suspense>
      </ErrorBoundary>
    </Workbench>
  );
}
