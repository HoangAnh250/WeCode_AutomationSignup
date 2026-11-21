import type { Transaction } from '../core/events.js';
import type { TaskCreate } from '../contracts/schemas.js';
import { AppError } from '../core/errors.js';

// Reserve a proxy during automatic task execution after pool preflight. One transaction
// lock serializes concurrent reservations; runtime leases remain capacity-limited.
export async function allocateAutomaticProxy(
  tx: Transaction,
  taskId: string,
  config: TaskCreate['config'],
) {
  const browser = config.browser;
  if (browser?.proxyMode !== 'auto' || config.proxyId || browser.profileId || browser.sessionId)
    return config;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(87640129)::text`;
  if (browser.assignedProxyId) return config; // Retry/resume preserve the identity's network binding.
  const batchId = config.batch?.id ?? null;
  const candidates = await tx.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM proxies p
    WHERE p.enabled = true AND p.status = 'healthy'
      AND NOT (p.protocol = 'socks5' AND p.username_cipher IS NOT NULL)
    ORDER BY
      (SELECT count(*) FROM tasks t WHERE t.deleted_at IS NULL AND t.id <> ${taskId}::uuid
        AND t.config->'browser'->>'proxyMode' = 'auto'
        AND t.config->'browser'->>'assignedProxyId' = p.id::text
        AND (t.config->'batch'->>'id') IS NOT DISTINCT FROM ${batchId}::text) ASC,
      (SELECT count(*) FROM tasks t WHERE t.deleted_at IS NULL AND t.id <> ${taskId}::uuid
        AND t.config->'browser'->>'assignedProxyId' = p.id::text) ASC,
      p.last_used_at ASC NULLS FIRST, p.id ASC
    LIMIT 1`;
  if (!candidates[0])
    throw new AppError(
      'NO_HEALTHY_PROXY',
      'Auto assign requires a healthy enabled Chromium-compatible proxy. Run proxy health checks or explicitly select Local.',
      503,
      true,
    );
  return { ...config, browser: { ...browser, assignedProxyId: candidates[0].id } };
}
