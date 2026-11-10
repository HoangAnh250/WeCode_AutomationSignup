import 'dotenv/config';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from '../src/core/config.js';
const config = loadConfig();
const child = spawn(process.execPath, ['dist/server.js'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let output = '';
child.stdout?.on('data', (data) => {
  output = (output + String(data)).slice(-10000);
});
child.stderr?.on('data', () => {});
const base = `http://${config.HOST === '::1' ? '[::1]' : config.HOST}:${config.PORT}`;
let ready = false;
try {
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error('Server exited during startup.');
    if (!output.includes('Desktop backend is listening.')) {
      await sleep(150);
      continue;
    }
    try {
      const response = await fetch(`${base}/health/ready`, {
        headers: { Authorization: `Bearer ${config.API_TOKEN}` },
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await sleep(150);
  }
  if (!ready) throw new Error('Server did not become ready.');
  const unauthorized = await fetch(`${base}/api/v1/accounts`);
  if (unauthorized.status !== 401) throw new Error('Unauthenticated request was not rejected.');
  const response = await fetch(`${base}/api/v1/accounts?limit=1`, {
    headers: { Authorization: `Bearer ${config.API_TOKEN}` },
  });
  const payload = (await response.json()) as { items?: unknown[] };
  if (!response.ok || !Array.isArray(payload.items))
    throw new Error('Authenticated account listing failed.');
  console.log(
    'PASS: compiled server startup, PostgreSQL/Redis readiness, 401 rejection, authenticated HTTP listing.',
  );
} finally {
  child.kill();
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    sleep(2000),
  ]);
}
