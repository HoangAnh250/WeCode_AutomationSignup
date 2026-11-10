import type { WorkspaceData, LogEntry } from '@/types/domain';
const actions = (s: string) =>
  s === 'running'
    ? ['pause' as const]
    : s === 'failed'
      ? ['retry' as const]
      : s === 'paused'
        ? ['resume' as const]
        : ['draft', 'pending'].includes(s)
          ? ['start' as const]
          : [];
export function createPreviewData(): WorkspaceData {
  const rows = [
    [
      'Weekly account onboarding',
      'running',
      68,
      34,
      50,
      'US Residential Pool',
      'Workspace 01',
      '12m 34s',
    ],
    [
      'Community verification',
      'running',
      42,
      21,
      50,
      'DE Datacenter Pool',
      'Workspace 02',
      '8m 12s',
    ],
    ['Artist membership sync', 'pending', 0, 0, 25, 'Auto assign', 'Workspace 03', '-'],
    [
      'Email verification batch',
      'success',
      100,
      120,
      120,
      'US Residential Pool',
      'Workspace 04',
      '24m 08s',
    ],
    [
      'Account recovery checks',
      'failed',
      36,
      9,
      25,
      'SG Residential Pool',
      'Workspace 05',
      '6m 43s',
    ],
    [
      'New member registration',
      'paused',
      24,
      6,
      25,
      'US Residential Pool',
      'Workspace 06',
      '3m 17s',
    ],
  ];
  return {
    tasks: rows.map((r, i) => ({
      id: `TSK-${1001 + i}`,
      name: String(r[0]),
      workflow: i === 2 ? 'Verification' : 'Weverse Signup',
      status: r[1] as WorkspaceData['tasks'][number]['status'],
      progress: Number(r[2]),
      completed: Number(r[3]),
      total: Number(r[4]),
      proxy: String(r[5]),
      profile: String(r[6]),
      duration: String(r[7]),
      retries: i === 4 ? 2 : 0,
      allowedActions: actions(String(r[1])),
      revision: 1,
    })),
    proxies: Array.from({ length: 8 }, (_, i) => ({
      id: `PRX-${201 + i}`,
      host: `192.0.2.${10 + i}`,
      port: 8000 + i,
      protocol: i === 3 ? 'socks5' : 'http',
      country: ['United States', 'Germany', 'Singapore', 'United Kingdom'][i % 4],
      health: i === 6 ? 'unreachable' : i === 7 ? 'unknown' : 'healthy',
      latency: i > 5 ? null : 82 + i * 19,
      assigned: i < 2 ? 1 : 0,
      hasCredentials: i % 2 === 0,
      checkedAt: new Date().toISOString(),
    })),
    profiles: Array.from({ length: 6 }, (_, i) => ({
      id: `PRO-${101 + i}`,
      name: `Workspace 0${i + 1}`,
      proxy: i < 2 ? `192.0.2.${10 + i}:800${i}` : 'Auto assign',
      status: i < 2 ? 'running' : i === 5 ? 'paused' : 'idle',
      lastActivity: new Date(Date.now() - i * 3600000).toISOString(),
      cookies: 12 + i * 3,
    })),
    accounts: Array.from({ length: 18 }, (_, i) => ({
      id: `ACC-${501 + i}`,
      email: `member.${String(i + 1).padStart(3, '0')}@example.test`,
      username: `weverse_member_${i + 1}`,
      proxy: `192.0.2.${10 + (i % 6)}`,
      createdAt: new Date(Date.now() - i * 480000).toISOString(),
      verification: i === 5 ? 'pending' : i === 11 ? 'failed' : 'verified',
    })),
    email: { address: 'workspace@example.test', configured: false, status: 'disconnected' },
    preferences: {
      concurrency: 3,
      catchallDomain: 'example.test',
      usernamePrefix: 'member',
      usernameLength: 12,
      passwordLength: 20,
      uppercase: true,
      numbers: true,
      symbols: true,
    },
  };
}
export function createPreviewLogs(): LogEntry[] {
  const now = Date.now();
  return [
    ['info', 'system', 'Workspace initialized. Frontend preview is active.'],
    ['success', 'browser', 'Chromium profile Workspace 01 is ready.'],
    ['info', 'queue', 'Execution slot assigned to TSK-1001.'],
    ['info', 'task', 'Weekly account onboarding started.'],
    ['info', 'network', 'POST /signup/otp-sessions ? 200 / 248 ms'],
    ['success', 'task', 'Email verification confirmed for current item.'],
    ['warn', 'network', 'Proxy PRX-207 is unavailable. Assignment skipped.'],
    ['error', 'task', 'TSK-1005 paused after a verification timeout.'],
    ['success', 'task', 'Email verification batch completed: 120 items.'],
    ['info', 'browser', 'Workspace 02 is waiting for the next workflow step.'],
  ].map((row, i) => ({
    id: `LOG-${i}`,
    timestamp: new Date(now - (10 - i) * 23000).toISOString(),
    level: row[0] as LogEntry['level'],
    category: row[1] as LogEntry['category'],
    message: row[2],
  }));
}
