import { it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { NodeProxyProbe } from '../../src/infrastructure/proxy-probe.js';
it('uses real HTTP proxy transport and sends proxy credentials only to the proxy', async () => {
  let url = '',
    auth = '';
  const server = http.createServer((req, res) => {
    url = req.url ?? '';
    auth = req.headers['proxy-authorization'] ?? '';
    res.writeHead(204);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const result = await new NodeProxyProbe('http://probe.example.test/health').check({
      host: '127.0.0.1',
      port,
      protocol: 'http',
      username: 'local-test-user',
      password: 'local-test-pass',
    });
    expect(result.healthy).toBe(true);
    expect(url).toBe('http://probe.example.test/health');
    expect(auth).toBe(`Basic ${Buffer.from('local-test-user:local-test-pass').toString('base64')}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
it('classifies proxy authentication rejection without exposing the credential', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(407);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await new NodeProxyProbe('http://probe.example.test/health').check({
      host: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      protocol: 'http',
    });
    expect(result).toMatchObject({ healthy: false, errorCode: 'PROXY_AUTH_FAILED' });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
