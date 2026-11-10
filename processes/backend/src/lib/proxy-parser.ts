import { parse } from 'csv-parse/sync';
import { proxyInputSchema, type ProxyInput } from '../contracts/schemas.js';
import { AppError } from '../core/errors.js';
export function normalizeProxy(value: unknown): ProxyInput {
  let item: unknown = value;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (raw.includes('://')) {
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        throw new Error('Invalid proxy URL.');
      }
      if ((u.pathname && u.pathname !== '/') || u.search || u.hash)
        throw new Error('Proxy URLs cannot contain paths or queries.');
      item = {
        protocol: u.protocol.replace(':', ''),
        host: u.hostname.replace(/^\[|\]$/g, ''),
        port: Number(u.port || (u.protocol === 'https:' ? 443 : u.protocol === 'http:' ? 80 : 0)),
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
      };
    } else {
      const m = raw.match(/^(\[[^\]]+\]|[^:]+):(\d+)(?::([^:]+):(.+))?$/);
      if (!m) throw new Error('Expected host:port or host:port:user:pass.');
      item = {
        protocol: 'http',
        host: m[1].replace(/^\[|\]$/g, ''),
        port: Number(m[2]),
        username: m[3],
        password: m[4],
      };
    }
  } else if (item && typeof item === 'object') {
    const p = item as Record<string, unknown>;
    item = { ...p, protocol: p.protocol ?? p.scheme ?? 'http', port: Number(p.port) };
    delete (item as Record<string, unknown>).scheme;
  }
  const result = proxyInputSchema.safeParse(item);
  if (!result.success)
    throw new Error('Invalid protocol, hostname, port or authentication fields.');
  return { ...result.data, host: result.data.host.toLowerCase() };
}
export function parseProxyImport(content: string, format: 'json' | 'txt' | 'csv') {
  let rows: unknown[];
  try {
    if (format === 'json') {
      const value: unknown = JSON.parse(content);
      if (!Array.isArray(value)) throw new Error();
      rows = value;
    } else if (format === 'csv') {
      rows = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        max_record_size: 4096,
      }) as unknown[];
    } else rows = content.split(/\r?\n/).filter((line) => line.trim());
  } catch {
    throw new AppError(
      'INVALID_IMPORT',
      'Invalid import structure. JSON requires an array; CSV requires a header row.',
      422,
    );
  }
  if (rows.length > 5000)
    throw new AppError('IMPORT_TOO_LARGE', 'Import at most 5000 entries.', 422);
  const valid: ProxyInput[] = [];
  const errors: { row: number; message: string }[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  rows.forEach((row, i) => {
    try {
      const p = normalizeProxy(row);
      const key = JSON.stringify([p.protocol, p.host, p.port, p.username ?? '']);
      if (seen.has(key)) {
        duplicates++;
        return;
      }
      seen.add(key);
      valid.push(p);
    } catch (error) {
      errors.push({
        row: i + 1,
        message: error instanceof Error ? error.message : 'Invalid entry.',
      });
    }
  });
  return { valid, errors, duplicates };
}
