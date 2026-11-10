import { z } from 'zod';
import { pageSchema } from '../core/pagination.js';
export const idSchema = z.string().uuid();
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Invalid catchall domain.');
export const passwordPolicySchema = z
  .object({
    length: z.number().int().min(12).max(128).default(20),
    uppercase: z.boolean().default(true),
    lowercase: z.boolean().default(true),
    numbers: z.boolean().default(true),
    special: z.boolean().default(true),
  })
  .strict()
  .refine(
    (p) => p.uppercase || p.lowercase || p.numbers || p.special,
    'Enable at least one character class.',
  );
export const identitySchema = z
  .object({
    domain: domainSchema,
    pattern: z
      .enum(['[random][digits]', '[firstName][digits]', '[word][digits]'])
      .default('[random][digits]'),
    randomLength: z.number().int().min(3).max(20).default(8),
    digits: z.number().int().min(2).max(10).default(4),
    password: passwordPolicySchema.default({
      length: 20,
      uppercase: true,
      lowercase: true,
      numbers: true,
      special: true,
    }),
    count: z.number().int().min(1).max(100).default(1),
  })
  .strict();
export const browserTaskSchema = z
  .object({
    profileId: idSchema.optional(),
    profileMode: z.enum(['isolated', 'persistent']).default('isolated'),
    proxyMode: z.enum(['direct', 'auto', 'fixed']).default('direct'),
    rotateOnFailure: z.boolean().default(false),
    sessionId: idSchema.optional(),
  })
  .strict();
export const profileCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    mode: z.enum(['isolated', 'persistent']).default('isolated'),
    proxyId: idSchema.optional(),
  })
  .strict();
export const taskConfigSchema = z
  .object({
    domain: domainSchema,
    pattern: z
      .enum(['[random][digits]', '[firstName][digits]', '[word][digits]'])
      .default('[random][digits]'),
    count: z.number().int().min(1).max(10000).default(1),
    password: passwordPolicySchema.default({
      length: 20,
      uppercase: true,
      lowercase: true,
      numbers: true,
      special: true,
    }),
    proxyId: idSchema.optional(),
    browser: browserTaskSchema.optional(),
  })
  .strict();
export const taskCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    config: taskConfigSchema,
    emailConfigId: idSchema.optional(),
  })
  .strict();
export const taskUpdateSchema = taskCreateSchema.extend({ version: z.number().int().positive() });
export const commandSchema = z.object({ version: z.number().int().positive() }).strict();
export const accountCreateSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    username: z.string().trim().min(1).max(80),
    password: z.string().min(1).max(256),
    proxyUsed: z
      .string()
      .max(512)
      .refine((v) => !v.includes('@'), 'Use a redacted proxy endpoint.')
      .optional(),
    status: z.enum(['created', 'verified', 'disabled']).default('created'),
    taskRunId: idSchema.optional(),
  })
  .strict();
export const accountQuerySchema = pageSchema.extend({
  status: z.enum(['created', 'verified', 'disabled']).optional(),
  taskRunId: idSchema.optional(),
});
export const exportQuerySchema = accountQuerySchema.extend({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  includePasswords: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export const proxyInputSchema = z
  .object({
    protocol: z.enum(['http', 'https', 'socks5']),
    host: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-zA-Z0-9.:[\]_-]+$/),
    port: z.number().int().min(1).max(65535),
    username: z.string().max(256).optional(),
    password: z.string().max(512).optional(),
  })
  .strict()
  .refine(
    (p) => Boolean(p.username) === Boolean(p.password),
    'Provide both proxy username and password.',
  );
export const proxyImportSchema = z
  .object({
    format: z.enum(['json', 'txt', 'csv']),
    content: z.string().min(1).max(2_000_000),
    dryRun: z.boolean().default(false),
  })
  .strict();
export const emailConfigSchema = z
  .object({
    inboxAddress: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    accountDomain: domainSchema.nullable().optional(),
    mailbox: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[^\x00-\x1f\x7f]+$/)
      .default('INBOX'),
    appPassword: z.string().min(8).max(512),
    host: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .regex(/^[a-zA-Z0-9.-]+$/),
    port: z.number().int().min(1).max(65535).default(993),
  })
  .strict();
export const emailUpdateSchema = emailConfigSchema
  .partial()
  .extend({
    version: z.number().int().positive(),
    mailbox: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[^\x00-\x1f\x7f]+$/)
      .optional(),
    port: z.number().int().min(1).max(65535).optional(),
  })
  .strict();
export const verificationSchema = z
  .object({
    recipient: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    sender: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    ttlSeconds: z.number().int().min(30).max(900).default(300),
  })
  .strict();
export const sessionSchema = z
  .object({
    accountId: idSchema,
    payload: z.record(z.string(), z.unknown()),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type TaskCreate = z.infer<typeof taskCreateSchema>;
export type AccountCreate = z.infer<typeof accountCreateSchema>;
export type ProxyInput = z.infer<typeof proxyInputSchema>;
