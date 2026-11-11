import { z } from 'zod';
import type { Page, Response } from 'playwright';
import { AppError } from '../../core/errors.js';
export const paths = {
  service: '/web/api/v4/weverse',
  otp: '/web/api/v2/signup/otp-sessions',
  send: /\/web\/api\/v2\/signup\/otp-sessions\/[^/]+\/send$/,
  auth: '/web/api/v2/signup/auth-codes',
  badWords: '/web/api/v2/resources/bad-words',
  terms: '/web/api/v4/terms/signup/weverse',
  signup: '/web/api/v6/signup/by-credentials',
  validate: '/api/v1/token/validate',
} as const;
export const serviceSchema = z.object({
  authMethods: z.object({ signup: z.array(z.string()) }),
  timeZoneRequired: z.boolean(),
});
export const otpSchema = z.object({ otpSessionId: z.string().min(1).max(256) });
export const sendSchema = z.object({ expiresIn: z.number().int().positive().max(86400) });
export const authSchema = z.object({
  authCode: z.string().min(1).max(4096),
  expiredAt: z.string().datetime({ offset: true }),
});
export const signupSchema = z.object({
  serviceUserId: z.string().min(1).max(256),
  accessToken: z.string().min(1).max(16384),
  refreshToken: z.string().min(1).max(16384),
  expiresIn: z.number().int().positive(),
});
export type Term = {
  termsCode: string;
  termsDocumentId: string;
  title: string;
  required: boolean;
  subTerms?: Term[];
};
const termSchema: z.ZodType<Term> = z.lazy(() =>
  z.object({
    termsCode: z.string(),
    termsDocumentId: z.string(),
    title: z.string(),
    required: z.boolean(),
    subTerms: z.array(termSchema).max(100).optional(),
  }),
);
export const termsSchema = z.object({
  terms: z.array(termSchema).max(100),
  termsGroups: z.array(z.object({ terms: z.array(termSchema).max(100) })).max(100),
});
export function flattenTerms(input: z.infer<typeof termsSchema>) {
  const result = new Map<string, Term>();
  const visit = (term: Term, depth = 0) => {
    if (depth > 8)
      throw new AppError('WEVERSE_TERMS_CHANGED', 'Unsupported nested consent structure.', 422);
    const existing = result.get(term.termsDocumentId);
    if (existing && (existing.required !== term.required || existing.title !== term.title))
      throw new AppError('WEVERSE_TERMS_CHANGED', 'Consent documents conflict.', 422);
    result.set(term.termsDocumentId, term);
    for (const child of term.subTerms ?? []) visit(child, depth + 1);
  };
  [...input.terms, ...input.termsGroups.flatMap((group) => group.terms)].forEach((term) =>
    visit(term),
  );
  if (!result.size)
    throw new AppError('WEVERSE_TERMS_CHANGED', 'No signup consent documents were available.', 422);
  return [...result.values()];
}
export type Observed = {
  body: unknown;
  request: Record<string, unknown>;
  authorization?: string;
  path: string;
};
export class WeverseNetworkObserver {
  constructor(
    private readonly page: Page,
    private readonly origin: string,
    private readonly timeout = 15000,
  ) {}
  capture(path: string | RegExp, method = 'POST', timeout = this.timeout): Promise<Observed> {
    const work = this.page
      .waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return (
            url.origin === this.origin &&
            response.request().method() === method &&
            (typeof path === 'string' ? url.pathname === path : path.test(url.pathname))
          );
        },
        { timeout },
      )
      .then((response) => this.read(response));
    // Callers arm observers before UI actions; observe rejection even if the action itself fails.
    void work.catch(() => {});
    return work;
  }
  private async read(response: Response): Promise<Observed> {
    if (!response.ok()) {
      const status = response.status();
      throw new AppError(
        status === 429
          ? 'WEVERSE_RATE_LIMITED'
          : status === 403
            ? 'WEVERSE_CHALLENGE_REQUIRED'
            : 'WEVERSE_REQUEST_REJECTED',
        `Weverse rejected a workflow request (HTTP ${status}).`,
        status >= 500 ? 502 : 422,
        status >= 500,
      );
    }
    try {
      const bytes = await response.body();
      if (bytes.byteLength > 1024 * 1024) throw new Error('size');
      const request = response.request().postDataJSON() as unknown;
      return {
        body: JSON.parse(bytes.toString('utf8')),
        request:
          request && typeof request === 'object' && !Array.isArray(request)
            ? (request as Record<string, unknown>)
            : {},
        authorization: response.request().headers().authorization,
        path: new URL(response.url()).pathname,
      };
    } catch {
      throw new AppError(
        'WEVERSE_PROTOCOL_CHANGED',
        'A Weverse response did not match the supported protocol.',
        502,
      );
    }
  }
}
export function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new AppError(
      'WEVERSE_PROTOCOL_CHANGED',
      'A Weverse response did not match the supported protocol.',
      502,
    );
  return parsed.data;
}
export const submissionSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  nickname: z.string(),
  authCode: z.string(),
  serviceId: z.string(),
  timeZone: z.string().optional(),
  blockOverseasSignin: z.boolean().optional(),
  termsAgreements: z.array(z.object({ termsDocumentId: z.string(), agreed: z.boolean() })).max(300),
});
