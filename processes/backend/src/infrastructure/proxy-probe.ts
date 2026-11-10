import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { ProxyInput } from '../contracts/schemas.js';
export interface ProxyProbe {
  check(
    proxy: ProxyInput,
  ): Promise<{ healthy: boolean; latencyMs: number | null; errorCode?: string }>;
}
export class NodeProxyProbe implements ProxyProbe {
  constructor(
    private readonly target: string,
    private readonly timeoutMs = 8000,
  ) {}
  async check(proxy: ProxyInput) {
    const endpoint = new URL(
      `${proxy.protocol}://${proxy.host.includes(':') ? `[${proxy.host}]` : proxy.host}:${proxy.port}`,
    );
    if (proxy.username) {
      endpoint.username = proxy.username;
      endpoint.password = proxy.password ?? '';
    }
    const url = new URL(this.target);
    const agent =
      proxy.protocol === 'socks5'
        ? new SocksProxyAgent(endpoint, { timeout: this.timeoutMs })
        : url.protocol === 'https:'
          ? new HttpsProxyAgent(endpoint, { timeout: this.timeoutMs })
          : new HttpProxyAgent(endpoint, { timeout: this.timeoutMs });
    const start = performance.now();
    try {
      return await new Promise<{ healthy: boolean; latencyMs: number | null; errorCode?: string }>(
        (resolve) => {
          let done = false;
          const finish = (result: {
            healthy: boolean;
            latencyMs: number | null;
            errorCode?: string;
          }) => {
            if (done) return;
            done = true;
            clearTimeout(deadline);
            resolve(result);
          };
          const request = (url.protocol === 'https:' ? https : http).request(
            url,
            { method: 'HEAD', agent, headers: { 'user-agent': 'WeCode-ProxyHealth/1.0' } },
            (response) => {
              response.resume();
              const healthy = Boolean(
                response.statusCode && response.statusCode >= 200 && response.statusCode < 400,
              );
              finish({
                healthy,
                latencyMs: Math.round(performance.now() - start),
                ...(!healthy
                  ? {
                      errorCode:
                        response.statusCode === 407 ? 'PROXY_AUTH_FAILED' : 'PROBE_HTTP_ERROR',
                    }
                  : {}),
              });
            },
          );
          const deadline = setTimeout(() => {
            request.destroy();
            finish({ healthy: false, latencyMs: null, errorCode: 'PROXY_TIMEOUT' });
          }, this.timeoutMs);
          request.on('error', () =>
            finish({ healthy: false, latencyMs: null, errorCode: 'PROXY_CONNECTION_FAILED' }),
          );
          request.end();
        },
      );
    } finally {
      agent.destroy();
    }
  }
}
