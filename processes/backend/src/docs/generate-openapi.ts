import { writeFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import * as s from '../contracts/schemas.js';
import { pageSchema } from '../core/pagination.js';
const schemas = {
  ProfileCreate: s.profileCreateSchema,
  ProfileProxy: z.object({ proxyId: s.idSchema.nullable() }).strict(),
  TaskCreate: s.taskCreateSchema,
  TaskBatchCreate: s.taskBatchCreateSchema,
  TaskUpdate: s.taskUpdateSchema,
  Command: s.commandSchema,
  AccountCreate: s.accountCreateSchema,
  ProxyImport: s.proxyImportSchema,
  EmailConfig: s.emailConfigSchema,
  EmailUpdate: s.emailUpdateSchema,
  Verification: s.verificationSchema,
  Identity: s.identitySchema,
  Session: s.sessionSchema,
  ProxyEnabled: z.object({ enabled: z.boolean() }).strict(),
};
const components = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => {
    const value = z.toJSONSchema(schema, { io: 'input' });
    delete value.$schema;
    return [name, value];
  }),
);
const paths: Record<string, Record<string, unknown>> = {};
function operation(
  method: string,
  path: string,
  summary: string,
  options: {
    body?: keyof typeof schemas;
    query?: z.ZodType;
    status?: number;
    secret?: boolean;
    binary?: boolean;
    public?: boolean;
  } = {},
) {
  const parameters: unknown[] = [];
  if (path.includes('{id}'))
    parameters.push({
      in: 'path',
      name: 'id',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    });
  if (options.query) {
    const schema = z.toJSONSchema(options.query, { io: 'input' }) as {
      properties?: Record<string, unknown>;
    };
    for (const [name, value] of Object.entries(schema.properties ?? {}))
      parameters.push({ in: 'query', name, required: false, schema: value });
  }
  if (method === 'post' && path === '/api/v1/tasks')
    parameters.push({
      in: 'header',
      name: 'Idempotency-Key',
      required: false,
      schema: { type: 'string', minLength: 8, maxLength: 128 },
    });
  paths[path] ??= {};
  paths[path][method] = {
    summary,
    security: options.public ? [] : [{ desktopToken: [] }],
    parameters,
    ...(options.body
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${options.body}` } },
            },
          },
        }
      : {}),
    responses: {
      [options.status ?? 200]: {
        description: options.secret
          ? 'Sensitive response; Cache-Control: no-store.'
          : options.binary
            ? 'CSV or XLSX attachment.'
            : 'Operation completed.',
        ...(options.binary
          ? {
              content: {
                'text/csv': { schema: { type: 'string' } },
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            }
          : {}),
      },
      '401': { description: 'Missing or invalid service token.' },
      '403': { description: 'Browser-origin request rejected.' },
      '409': { description: 'Version conflict, duplicate identity, or unsafe transition.' },
      '422': { description: 'Input validation failed; fields returned without input values.' },
      '500': { description: 'Sanitized internal error.' },
      '502': { description: 'Mailbox or network dependency unavailable.' },
    },
  };
}
operation('get', '/health/live', 'Process liveness', { public: true });
operation('get', '/health/ready', 'PostgreSQL and queue readiness');
operation(
  'get',
  '/api/v1/browser-profiles',
  'List local profile metadata; no browser storage or secrets',
);
operation(
  'post',
  '/api/v1/browser-profiles',
  'Create isolated or persistent local browser profile',
  { body: 'ProfileCreate', status: 201 },
);
operation('delete', '/api/v1/browser-profiles/{id}', 'Soft-delete an idle local profile', {
  status: 204,
});
operation(
  'patch',
  '/api/v1/browser-profiles/{id}/proxy',
  'Assign a proxy to an idle local profile',
  { body: 'ProfileProxy' },
);
operation(
  'post',
  '/api/v1/tasks/batch',
  'Create an idempotent batch of isolated one-account task rows',
  { body: 'TaskBatchCreate', status: 201 },
);
operation('get', '/api/v1/tasks', 'List account-creation tasks', { query: pageSchema });
operation('post', '/api/v1/tasks', 'Create a draft task', { body: 'TaskCreate', status: 201 });
operation('get', '/api/v1/tasks/{id}', 'Get task and latest 20 runs');
operation('patch', '/api/v1/tasks/{id}', 'Update editable task with expected version', {
  body: 'TaskUpdate',
});
operation('delete', '/api/v1/tasks/{id}', 'Soft-delete an idle task', {
  body: 'Command',
  status: 204,
});
for (const action of ['start', 'pause', 'resume', 'retry'])
  operation(
    'post',
    `/api/v1/tasks/{id}/${action}`,
    `${action} task; inspect returned actual state`,
    { body: 'Command', status: 202 },
  );
operation('get', '/api/v1/task-runs/{id}', 'Read one execution and its checkpoint/outcome');
operation('get', '/api/v1/accounts', 'Search/filter/paginate account metadata; no passwords', {
  query: s.accountQuerySchema,
});
operation('post', '/api/v1/accounts', 'Store an externally created account result', {
  body: 'AccountCreate',
  status: 201,
});
operation('get', '/api/v1/accounts/{id}', 'Read account metadata');
operation('get', '/api/v1/accounts/{id}/password', 'Explicitly reveal and audit one password', {
  secret: true,
});
operation(
  'get',
  '/api/v1/exports/accounts',
  'Stream matching accounts; masked passwords by default',
  { query: s.exportQuerySchema, binary: true },
);
operation('get', '/api/v1/proxies', 'List proxy metadata', { query: pageSchema });
operation('post', '/api/v1/proxies/import', 'Validate/import JSON, TXT or headered CSV', {
  body: 'ProxyImport',
});
operation(
  'post',
  '/api/v1/proxies/rotate',
  'Select next enabled healthy proxy and increment assignment statistics',
);
operation('get', '/api/v1/proxies/statistics', 'Pool usage statistics');
operation('post', '/api/v1/proxies/{id}/check', 'Probe configured HTTP(S) target through proxy');
operation('get', '/api/v1/proxies/{id}/health', 'Latest 100 health checks');
operation('patch', '/api/v1/proxies/{id}', 'Enable or disable proxy', { body: 'ProxyEnabled' });
operation('get', '/api/v1/email-configs', 'List mailbox metadata');
operation(
  'get',
  '/api/v1/email-configs/{id}/app-password',
  'Load saved IMAP App Password for the local settings form',
  { secret: true },
);
operation(
  'get',
  '/api/v1/email-configs/{id}/verifications',
  'List verification metadata for the selected OTP inbox; no codes',
);
operation('post', '/api/v1/email-configs', 'Create encrypted TLS IMAP configuration', {
  body: 'EmailConfig',
  status: 201,
});
operation('patch', '/api/v1/email-configs/{id}', 'Update mailbox with expected version', {
  body: 'EmailUpdate',
});
operation('post', '/api/v1/email-configs/{id}/test', 'Test authenticated TLS IMAP connection');
operation(
  'post',
  '/api/v1/email-configs/{id}/verifications',
  'Create recipient/sender-correlated verification request',
  { body: 'Verification', status: 201 },
);
operation(
  'get',
  '/api/v1/verifications/{id}',
  'Read verification state, never auto-marked verified',
);
operation('post', '/api/v1/verifications/{id}/scan', 'Scan at most 100 recent bounded messages');
operation('get', '/api/v1/verifications/{id}/code', 'Read detected, unexpired code with audit', {
  secret: true,
});
operation(
  'post',
  '/api/v1/catchall/identities',
  'Generate CSPRNG identities; does not create website accounts',
  { body: 'Identity', secret: true },
);
operation('get', '/api/v1/sessions', 'List account session metadata', {
  query: z.object({ accountId: s.idSchema }),
});
operation('post', '/api/v1/sessions', 'Store encrypted session payload', {
  body: 'Session',
  status: 201,
});
operation('post', '/api/v1/sessions/{id}/revoke', 'Revoke local saved session', { status: 204 });
operation('get', '/api/v1/queue', 'Return waiting/active/completed/failed/delayed/paused counts');
operation('post', '/api/v1/queue/pause', 'Pause acquisition; active jobs continue', {
  status: 202,
});
operation('post', '/api/v1/queue/resume', 'Resume queue acquisition', { status: 202 });
operation('get', '/api/v1/logs', 'Paginated redacted audit log', { query: pageSchema });
await mkdir('api', { recursive: true });
await writeFile(
  'api/openapi.json',
  JSON.stringify(
    {
      openapi: '3.1.0',
      info: {
        title: 'WeCode Desktop Backend',
        version: '0.1.0',
        description:
          'Loopback internal service, called by Electron main/preload adapters. No Playwright implementation. All private routes require a service token and reject browser Origin headers.',
      },
      servers: [{ url: 'http://127.0.0.1:4317' }],
      components: {
        securitySchemes: { desktopToken: { type: 'http', scheme: 'bearer' } },
        schemas: components,
      },
      paths,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Generated OpenAPI contract: ${Object.keys(paths).length} paths.`);
