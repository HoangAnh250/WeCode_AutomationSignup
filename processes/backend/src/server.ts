import { loadConfig } from './core/config.js';
import { createContainer } from './composition.js';
import { createApp } from './http/app.js';
const config = loadConfig();
const c = createContainer(config);
await c.db.$connect();
c.outbox.start();
const server = createApp(c).listen(config.PORT, config.HOST, () =>
  c.logger.info({ host: config.HOST, port: config.PORT }, 'Desktop backend is listening.'),
);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  c.logger.info({ event: 'shutdown.started' }, 'Stopping backend.');
  const deadline = setTimeout(() => process.exit(1), 30000);
  deadline.unref();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await c.outbox.stop();
  await c.queue.close();
  await c.db.$disconnect();
  clearTimeout(deadline);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
server.on('error', () => {
  c.logger.fatal(
    { event: 'server.bind_failed' },
    'Backend could not bind to its configured address.',
  );
  void shutdown();
  process.exitCode = 1;
});
