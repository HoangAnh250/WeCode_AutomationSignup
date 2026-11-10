import { useEffect, useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  ListTodo,
  Globe,
  Monitor,
  Users,
  Mail,
  Terminal,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  Search,
  Command,
  HelpCircle,
  Radio,
  ArrowUpRight,
  Layers,
  Check,
  AlertCircle,
  X,
} from 'lucide-react';
import { useWorkbench } from '@/stores/workbench.store';
import { useNotifications } from '@/stores/notification.store';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { client } from '@/ipc/client';
import type { PageId, WorkspaceData } from '@/types/domain';
const nav = [
  { id: 'dashboard', name: 'Overview', icon: LayoutDashboard },
  { id: 'tasks', name: 'Tasks', icon: ListTodo },
  { id: 'proxies', name: 'Proxies', icon: Globe },
  { id: 'profiles', name: 'Browser profiles', icon: Monitor },
  { id: 'accounts', name: 'Accounts', icon: Users },
  { id: 'email', name: 'Email integration', icon: Mail },
  { id: 'logs', name: 'Logs', icon: Terminal },
  { id: 'settings', name: 'Settings', icon: Settings },
] as const;
export function Workbench({ children, data }: { children: ReactNode; data?: WorkspaceData }) {
  const { page, navigate, collapsed, toggleSidebar, density } = useWorkbench();
  const [command, setCommand] = useState(false);
  const [term, setTerm] = useState('');
  const [help, setHelp] = useState(false);
  const notices = useNotifications((s) => s.notices);
  const dismiss = useNotifications((s) => s.dismiss);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommand((v) => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleSidebar]);
  const go = (id: PageId) => {
    navigate(id);
    setCommand(false);
    setTerm('');
  };
  const active = data?.tasks.filter((t) => t.status === 'running').length;
  return (
    <div className={`workbench ${collapsed ? 'is-collapsed' : ''} density-${density}`}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            W<span />
          </span>
          {!collapsed && (
            <>
              <strong>
                WeCode<span>Desktop</span>
              </strong>
              <span className="version-label">beta</span>
            </>
          )}
        </div>
        <button
          className="workspace-picker"
          onClick={() =>
            useNotifications
              .getState()
              .push(
                'Local workspace is active. Workspace switching requires desktop services.',
                'info',
              )
          }
          title="Local workspace"
        >
          <span className="workspace-avatar">W</span>
          {!collapsed && (
            <>
              <span>
                <strong>Local workspace</strong>
                <small>Personal workspace</small>
              </span>
              <ChevronDown size={14} />
            </>
          )}
        </button>
        <div className="nav-section-label">Workspace</div>
        <nav aria-label="Main navigation">
          {nav.slice(0, 7).map((item) => (
            <button
              key={item.id}
              title={collapsed ? item.name : undefined}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              aria-current={page === item.id ? 'page' : undefined}
              aria-label={item.name}
              onClick={() => go(item.id)}
            >
              <item.icon size={18} />
              {!collapsed && (
                <>
                  <span>{item.name}</span>
                  {item.id === 'tasks' && active !== undefined && active > 0 && (
                    <span className="nav-count">{active}</span>
                  )}
                  {item.id === 'logs' && <span className="nav-live" />}
                </>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {!collapsed && (
            <div className="local-card">
              <span className="local-card-icon">
                <Layers size={17} />
              </span>
              <div>
                <strong>Your desktop, connected.</strong>
                <p>One workspace for every workflow.</p>
              </div>
            </div>
          )}
          <button
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            aria-current={page === 'settings' ? 'page' : undefined}
            aria-label="Settings"
            title={collapsed ? 'Settings' : undefined}
            onClick={() => go('settings')}
          >
            <Settings size={18} />
            {!collapsed && <span>Settings</span>}
          </button>
          <button
            className="nav-item"
            onClick={() => setHelp(true)}
            aria-label="Help and shortcuts"
          >
            <HelpCircle size={18} />
            {!collapsed && (
              <>
                <span>Help & shortcuts</span>
                <ArrowUpRight size={14} />
              </>
            )}
          </button>
          <div className="sidebar-account">
            <span className="user-avatar">LC</span>
            {!collapsed && (
              <div>
                <strong>Local operator</strong>
                <small>This device</small>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={toggleSidebar}
            >
              {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </Button>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="muted">Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <span>{nav.find((n) => n.id === page)?.name}</span>
          </div>
          <div className="topbar-right">
            <button className="global-search" onClick={() => setCommand(true)}>
              <Search size={14} />
              <span>Jump to...</span>
              <kbd>Ctrl K</kbd>
            </button>
            <span className={`connection-label ${client.mode}`}>
              <span />
              {client.mode === 'preview'
                ? 'Preview mode'
                : client.mode === 'desktop'
                  ? 'Desktop bridge'
                  : 'Services unavailable'}
            </span>
            <span className="topbar-divider" />
            <span className="user-avatar small">LC</span>
          </div>
        </header>
        {client.mode === 'preview' && (
          <div className="preview-banner">
            <span>Frontend preview</span>Sample data / changes last for this session / no browser
            automation runs
          </div>
        )}
        <main id="main-content" className="main-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="statusbar">
          <span className={client.mode === 'unavailable' ? 'status-warn' : 'status-connected'}>
            <Radio size={12} />
            {client.mode === 'preview'
              ? 'Preview adapter'
              : client.mode === 'desktop'
                ? 'IPC bridge available'
                : 'IPC bridge unavailable'}
          </span>
          <span className="status-separator" />
          <span>{active === undefined ? '?' : active} running tasks</span>
          <span className="spacer" />
          <span>Local workspace</span>
          <span className="status-separator" />
          <span>WeCode 0.1.0</span>
        </footer>
      </div>
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {notices.map((n) => (
          <div className={`toast ${n.tone}`} key={n.id}>
            {n.tone === 'error' ? <AlertCircle size={18} /> : <Check size={18} />}
            <span>{n.message}</span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Dismiss notification"
              onClick={() => dismiss(n.id)}
            >
              <X size={14} />
            </Button>
          </div>
        ))}
      </div>
      <Dialog
        open={command}
        onOpenChange={setCommand}
        title="Jump to a page"
        description="Navigate your workspace without leaving the keyboard."
      >
        <div className="form-stack">
          <Input
            autoFocus
            aria-label="Find a page"
            placeholder="Type a page name..."
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <div className="command-list">
            {nav
              .filter((n) => n.name.toLowerCase().includes(term.toLowerCase()))
              .map((n) => (
                <button key={n.id} onClick={() => go(n.id)}>
                  <n.icon size={18} />
                  <span>{n.name}</span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
          </div>
        </div>
      </Dialog>
      <Dialog
        open={help}
        onOpenChange={setHelp}
        title="Help & shortcuts"
        description="A focused workspace for desktop automation."
      >
        <div className="form-stack">
          <div className="shortcut-row">
            <span>Jump to a page</span>
            <kbd>Ctrl / Cmd K</kbd>
          </div>
          <div className="shortcut-row">
            <span>Toggle sidebar</span>
            <kbd>Ctrl / Cmd B</kbd>
          </div>
          <div className="shortcut-row">
            <span>Close dialog</span>
            <kbd>Esc</kbd>
          </div>
          <p className="muted">
            Task actions are confirmed by desktop services. In development preview, changes affect
            sample data only. Native browser automation and mailbox access require the preload
            bridge.
          </p>
        </div>
        <div className="dialog-footer">
          <Button onClick={() => setHelp(false)}>Got it</Button>
        </div>
      </Dialog>
    </div>
  );
}
