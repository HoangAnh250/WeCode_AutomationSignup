import type { ProxyInput } from '@/types/domain';
export interface ImportPreview {
  valid: ProxyInput[];
  invalid: { line: number; reason: string }[];
  duplicates: number;
}
function normalize(value: unknown): ProxyInput {
  let host: string,
    port: number,
    protocol: ProxyInput['protocol'] = 'http',
    username: string | undefined,
    password: string | undefined;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (raw.includes('://')) {
      const u = new URL(raw);
      if (!['http:', 'https:', 'socks5:'].includes(u.protocol))
        throw new Error('Use http, https or socks5.');
      if ((u.pathname && u.pathname !== '/') || u.search || u.hash)
        throw new Error('Proxy URL must not contain a path or query.');
      host = u.hostname;
      port = Number(u.port);
      protocol = u.protocol.slice(0, -1) as ProxyInput['protocol'];
      username = u.username ? decodeURIComponent(u.username) : undefined;
      password = u.password ? decodeURIComponent(u.password) : undefined;
    } else {
      const match = raw.match(/^(\[[^\]]+\]|[^:]+):(\d+)(?::([^:]+):(.+))?$/);
      if (!match) throw new Error('Expected host:port or host:port:user:pass.');
      host = match[1];
      port = Number(match[2]);
      username = match[3];
      password = match[4];
    }
  } else if (value && typeof value === 'object') {
    const p = value as Record<string, unknown>;
    host = String(p.host ?? '');
    port = Number(p.port);
    protocol = String(p.protocol ?? p.scheme ?? 'http').replace(':', '') as ProxyInput['protocol'];
    username = typeof p.username === 'string' ? p.username : undefined;
    password = typeof p.password === 'string' ? p.password : undefined;
  } else throw new Error('Expected a proxy string or object.');
  if (!host || /\s|[\/@?#]/.test(host)) throw new Error('Invalid proxy hostname.');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Port must be between 1 and 65535.');
  if (!['http', 'https', 'socks5'].includes(protocol)) throw new Error('Unsupported protocol.');
  if (Boolean(username) !== Boolean(password))
    throw new Error('Provide both username and password.');
  return { host: host.toLowerCase(), port, protocol, username, password };
}
export function parseProxies(text: string, format: 'json' | 'txt'): ImportPreview {
  if (text.length > 2_000_000) throw new Error('Import is limited to 2 MB.');
  let rows: unknown[];
  if (format === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Invalid JSON. Provide an array of proxy strings or objects.');
    }
    if (!Array.isArray(parsed))
      throw new Error('JSON must contain an array of proxy strings or objects.');
    rows = parsed;
  } else rows = text.split(/\r?\n/);
  if (rows.length > 5000) throw new Error('Import at most 5,000 lines at a time.');
  const out: ImportPreview = { valid: [], invalid: [], duplicates: 0 };
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    if (typeof row === 'string' && !row.trim()) return;
    try {
      const p = normalize(row);
      const key = JSON.stringify([p.protocol, p.host, p.port, p.username ?? '']);
      if (seen.has(key)) {
        out.duplicates++;
        return;
      }
      seen.add(key);
      out.valid.push(p);
    } catch (error) {
      out.invalid.push({
        line: i + 1,
        reason: error instanceof Error ? error.message : 'Invalid entry.',
      });
    }
  });
  return out;
}
