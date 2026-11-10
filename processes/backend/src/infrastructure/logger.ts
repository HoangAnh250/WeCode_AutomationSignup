import pino from 'pino';
export function createLogger(level = 'info') {
  return pino({
    level,
    base: { service: 'wecode-backend' },
    redact: {
      paths: [
        'password',
        'appPassword',
        'token',
        'authorization',
        'encryptionKey',
        '*.password',
        '*.appPassword',
        '*.passwordCipher',
        'stateCipher',
        'payloadCipher',
        '*.stateCipher',
        '*.payloadCipher',
        'cookies',
        '*.cookies',
        'ownerToken',
        '*.ownerToken',
        'leaseToken',
        '*.leaseToken',
        '*.codeCipher',
        'req.headers.authorization',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      err: (e: unknown) => ({
        type: e instanceof Error ? e.name : 'UnknownError',
        code: (e as { code?: string })?.code,
      }),
    },
  });
}
export type Logger = ReturnType<typeof createLogger>;
