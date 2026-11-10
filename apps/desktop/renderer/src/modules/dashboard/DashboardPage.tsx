import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Layers,
  Activity,
  Clock3,
  CheckCheck,
  TriangleAlert,
  Globe,
  ShieldCheck,
  Monitor,
  MoreHorizontal,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useWorkbench } from '@/stores/workbench.store';
import type { WorkspaceData } from '@/types/domain';
export function DashboardPage({ data, onCreate }: { data: WorkspaceData; onCreate: () => void }) {
  const navigate = useWorkbench((s) => s.navigate);
  const tasks = data.tasks;
  const running = tasks.filter((t) => t.status === 'running');
  const healthy = data.proxies.filter((p) => p.health === 'healthy').length;
  const completed = tasks.filter((t) => t.status === 'success').length;
  const failed = tasks.filter((t) =>
    ['failed', 'blocked', 'needs_reconciliation'].includes(t.status),
  ).length;
  const stats = [
    {
      label: 'Total tasks',
      value: tasks.length,
      icon: Layers,
      tone: 'neutral',
      detail: 'Across this workspace',
    },
    {
      label: 'Running',
      value: running.length,
      icon: Activity,
      tone: 'blue',
      detail: 'Active executions',
    },
    {
      label: 'Pending',
      value: tasks.filter((t) => ['draft', 'pending'].includes(t.status)).length,
      icon: Clock3,
      tone: 'amber',
      detail: 'Ready for execution',
    },
    {
      label: 'Successful',
      value: completed,
      icon: CheckCheck,
      tone: 'green',
      detail: 'Completed workflows',
    },
    {
      label: 'Failed',
      value: failed,
      icon: TriangleAlert,
      tone: 'red',
      detail: 'Need your attention',
    },
  ];
  const finished = completed + failed;
  const percent = finished ? Math.round((completed / finished) * 100) : 0;
  return (
    <>
      <PageHeader
        title="Workspace overview"
        description="Your automation operations, all in one place."
        actions={
          <>
            <Button onClick={() => navigate('logs')}>
              <Activity size={15} />
              View activity
            </Button>
            <Button variant="default" onClick={onCreate}>
              <Plus size={16} />
              Create task
            </Button>
          </>
        }
      />
      <div className="stats-grid">
        {stats.map((s) => (
          <section className="stat-card" key={s.label}>
            <div className="stat-top">
              <span>{s.label}</span>
              <span className={`stat-icon ${s.tone}`}>
                <s.icon size={16} />
              </span>
            </div>
            <div className="stat-value">
              {s.value}
              <span className={`stat-mini ${s.tone}`}>
                {s.label === 'Running' && running.length > 0 ? 'Live' : <ArrowUpRight size={16} />}
              </span>
            </div>
            <div className="stat-detail">{s.detail}</div>
          </section>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel execution-panel">
          <div className="panel-heading">
            <div>
              <h2>
                Running tasks <span className="count-pill">{running.length}</span>
              </h2>
              <p>Live workflows currently in progress</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('tasks')}>
              View all
              <ArrowRight size={14} />
            </Button>
          </div>
          {running.length ? (
            running.map((t) => (
              <div className="running-task" key={t.id}>
                <div className="running-task-top">
                  <span className="workflow-icon">
                    <Layers size={19} />
                  </span>
                  <div className="running-task-title">
                    <strong>{t.name}</strong>
                    <span>
                      {t.id} <span className="separator">/</span> {t.workflow}
                    </span>
                  </div>
                  <Badge value="running" />
                </div>
                <div className="running-progress">
                  <span>Processing accounts</span>
                  <span>
                    <strong>{t.completed}</strong> / {t.total}
                    <span className="progress-percent">{t.progress}%</span>
                  </span>
                </div>
                <progress value={t.progress} max={100} aria-label={`${t.name} progress`} />
                <div className="running-task-meta">
                  <span>
                    <Globe size={13} />
                    {t.proxy}
                  </span>
                  <span>
                    <Clock3 size={13} />
                    {t.duration}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <Activity />
              <h3>No tasks running</h3>
              <p>Start a task to see execution progress here.</p>
              <Button onClick={() => navigate('tasks')}>Open tasks</Button>
            </div>
          )}
          <div className="panel-bottom">
            <span className="pulse-dot" />
            Updates follow execution events
            <span className="spacer" />
            <span>{running.length} active</span>
          </div>
        </section>
        <section className="panel outcome-panel">
          <div className="panel-heading">
            <div>
              <h2>Execution outcomes</h2>
              <p>Completed tasks in this workspace</p>
            </div>
            <CheckCheck size={18} className="muted" />
          </div>
          <div className="outcome-chart">
            <svg
              viewBox="0 0 180 180"
              role="img"
              aria-label={`Success rate ${percent} percent across ${finished} completed tasks`}
            >
              <circle cx="90" cy="90" r="69" className="donut-track" />
              <circle
                cx="90"
                cy="90"
                r="69"
                className="donut-value"
                strokeDasharray={`${percent * 4.335} 433.54`}
              />
              <text x="90" y="86" textAnchor="middle" className="donut-number">
                {percent}%
              </text>
              <text x="90" y="109" textAnchor="middle" className="donut-label">
                success rate
              </text>
            </svg>
          </div>
          <div className="outcome-legend">
            <div>
              <span className="legend-dot green-bg" />
              Successful<strong>{completed}</strong>
            </div>
            <div>
              <span className="legend-dot red-bg" />
              Failed<strong>{failed}</strong>
            </div>
          </div>
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Proxy network</h2>
              <p>Connection pool health and availability</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => navigate('proxies')}>
              Manage
              <ArrowRight size={14} />
            </Button>
          </div>
          <div className="proxy-overview">
            <div className="proxy-symbol">
              <Globe size={26} />
            </div>
            <div>
              <strong>
                {healthy}
                <span> / {data.proxies.length}</span>
              </strong>
              <p>Healthy proxies</p>
            </div>
            <Badge
              value={healthy === data.proxies.length ? 'healthy' : 'pending'}
              label={healthy === data.proxies.length ? 'All healthy' : 'Review pool'}
            />
          </div>
          <div
            className="health-strip"
            aria-label={`${healthy} healthy proxies out of ${data.proxies.length}`}
          >
            {data.proxies.map((p) => (
              <span
                key={p.id}
                className={`health-segment ${p.health}`}
                title={`${p.host}: ${p.health}`}
              />
            ))}
          </div>
          <div className="proxy-summary">
            <span>
              <span className="legend-dot green-bg" />
              {healthy} healthy
            </span>
            <span>
              <span className="legend-dot red-bg" />
              {data.proxies.filter((p) => p.health === 'unreachable').length} unavailable
            </span>
            <span>
              <span className="legend-dot gray-bg" />
              {data.proxies.filter((p) => p.health === 'unknown').length} unchecked
            </span>
          </div>
        </section>
        <section className="panel quick-panel">
          <div className="panel-heading">
            <div>
              <h2>Workspace resources</h2>
              <p>Everything your workflows run on</p>
            </div>
            <MoreHorizontal size={18} className="muted" />
          </div>
          <button className="resource-row" onClick={() => navigate('profiles')}>
            <span className="resource-icon">
              <Monitor size={18} />
            </span>
            <span>
              <strong>Browser profiles</strong>
              <small>Isolated Chromium workspaces</small>
            </span>
            <b>{data.profiles.length}</b>
            <ArrowRight size={15} />
          </button>
          <button className="resource-row" onClick={() => navigate('accounts')}>
            <span className="resource-icon">
              <ShieldCheck size={18} />
            </span>
            <span>
              <strong>Verified accounts</strong>
              <small>Successful verification records</small>
            </span>
            <b>{data.accounts.filter((a) => a.verification === 'verified').length}</b>
            <ArrowRight size={15} />
          </button>
        </section>
      </div>
    </>
  );
}
