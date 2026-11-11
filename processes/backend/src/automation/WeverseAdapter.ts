import { createHash } from 'node:crypto';
import type { Route } from 'playwright';
import { z } from 'zod';
import { taskConfigSchema, identitySchema } from '../contracts/schemas.js';
import type { ExecutionContext } from '../queue/executor.js';
import { CatchallManager } from '../services/identity.service.js';
import { AppError } from '../core/errors.js';
import type { BrowserWorkflow, BrowserWorkflowContext, WorkflowResult } from './contracts.js';
import type { WeverseStateStore, WeverseState } from './weverse/state.js';
import { WeversePage } from './weverse/WeversePage.js';
import {
  WeverseNetworkObserver,
  paths,
  parseResponse,
  serviceSchema,
  otpSchema,
  sendSchema,
  authSchema,
  signupSchema,
  termsSchema,
  flattenTerms,
  submissionSchema,
  type Term,
} from './weverse/protocol.js';
export interface WeverseAdapterOptions {
  store: WeverseStateStore;
  identities: CatchallManager;
  otpSender: string;
  event?: (execution: ExecutionContext, event: string) => Promise<void>;
  /** Local fixtures only. Production origins cannot be supplied through task input or environment. */
  testSite?: { accountOrigin: string; apiOrigin: string; redirectUri: string };
  responseTimeoutMs?: number;
}
export class WeverseAdapter implements BrowserWorkflow {
  readonly key = 'create-account';
  readonly version = '1';
  private readonly site: { accountOrigin: string; apiOrigin: string; redirectUri: string };
  constructor(private readonly options: WeverseAdapterOptions) {
    z.string().email().parse(options.otpSender);
    if (options.testSite && process.env.NODE_ENV !== 'test')
      throw new Error('Fixture origins are test-only.');
    this.site = options.testSite ?? {
      accountOrigin: 'https://account.weverse.io',
      apiOrigin: 'https://accountapi.weverse.io',
      redirectUri: 'https://weverse.io/login/result',
    };
  }
  private result(state: WeverseState, saveSession = false): WorkflowResult {
    return {
      account: { ...state.identity, status: 'verified' },
      sessionDisposition: saveSession ? 'save' : 'skip',
    };
  }
  async recover(execution: ExecutionContext): Promise<WorkflowResult | undefined> {
    const state = await this.options.store.read(execution);
    return state?.confirmed ? this.result(state) : undefined;
  }
  async validateSession(): Promise<boolean> {
    return false;
  } // Signup never reuses an existing authenticated account.
  private async stage(execution: ExecutionContext, stage: string) {
    await execution.assertCanContinue();
    await execution.saveCheckpoint({ weverse: { version: this.version, stage } });
    await this.options.event?.(execution, `task.weverse.${stage}`);
  }
  async execute(ctx: BrowserWorkflowContext): Promise<WorkflowResult> {
    const execution = ctx.execution;
    const config = taskConfigSchema.parse(execution.config);
    if (config.count !== 1)
      throw new AppError(
        'BATCH_REQUIRES_CHILD_TASKS',
        'Weverse requires one account per task run.',
        422,
      );
    if (ctx.restoredAccountId)
      throw new AppError(
        'WEVERSE_EXISTING_SESSION',
        'Account creation cannot reuse an existing account session.',
        409,
      );
    if (!ctx.waitForOtp)
      throw new AppError(
        'MAILBOX_REQUIRED',
        'OTP monitoring is required for account creation.',
        422,
      );
    if (
      config.password.length > 32 ||
      !config.password.numbers ||
      !config.password.special ||
      (!config.password.uppercase && !config.password.lowercase)
    )
      throw new AppError(
        'WEVERSE_PASSWORD_POLICY',
        'Weverse passwords require letters, numbers and symbols, with at most 32 characters.',
        422,
      );
    const configHash = createHash('sha256')
      .update(
        JSON.stringify({
          domain: config.domain,
          pattern: config.pattern,
          password: config.password,
        }),
      )
      .digest('hex');
    let state = await this.options.store.mutate(execution, (previous) => {
      if (previous?.confirmed) return previous;
      if (previous?.configHash === configHash) return previous;
      const identity = this.options.identities.generate(
        identitySchema.parse({
          domain: config.domain,
          pattern: config.pattern,
          password: config.password,
          count: 1,
        }),
      )[0];
      return { version: 1, configHash, identity };
    });
    if (state.confirmed) return this.result(state);
    await this.stage(execution, 'identity_ready');
    const network = new WeverseNetworkObserver(
      ctx.page,
      this.site.apiOrigin,
      this.options.responseTimeoutMs,
    );
    const view = new WeversePage(ctx, this.site.accountOrigin);
    let agreements: Term[] | undefined;
    let submitArmed = false,
      submitted = false;
    let rejectGate!: (error: unknown) => void;
    const gateFailure = new Promise<never>((_, reject) => {
      rejectGate = reject;
    });
    void gateFailure.catch(() => {});
    const gatePattern = '**/web/api/v6/signup/by-credentials*';
    const gate = async (route: Route) => {
      if (submitted) {
        await route.abort('blockedbyclient');
        return;
      }
      try {
        const request = route.request();
        if (
          new URL(request.url()).origin !== this.site.apiOrigin ||
          request.method() !== 'POST' ||
          !submitArmed ||
          !agreements
        )
          throw new AppError(
            'WEVERSE_UNEXPECTED_SUBMISSION',
            'An unexpected signup request was blocked.',
            409,
          );
        const payload = parseResponse(submissionSchema, request.postDataJSON());
        if (payload.blockOverseasSignin !== false)
          throw new AppError(
            'WEVERSE_OVERSEAS_BLOCK_ENABLED',
            'Signup was blocked because Block Overseas Logins was not disabled.',
            422,
          );
        const otp = state.otp;
        const docs = new Map(
          payload.termsAgreements.map((term) => [term.termsDocumentId, term.agreed]),
        );
        if (
          payload.email.toLowerCase() !== state.identity.email ||
          payload.password !== state.identity.password ||
          payload.nickname !== state.identity.username ||
          payload.authCode !== otp?.authCode ||
          !otp.authExpiresAt ||
          new Date(otp.authExpiresAt) <= new Date() ||
          payload.serviceId !== 'weverse' ||
          (config.weverse?.timeZone && payload.timeZone !== config.weverse.timeZone) ||
          docs.size !== payload.termsAgreements.length ||
          docs.size !== agreements.length ||
          agreements.some((term) => docs.get(term.termsDocumentId) !== true)
        )
          throw new AppError(
            'WEVERSE_SUBMISSION_MISMATCH',
            'Signup payload differs from the active identity, verification or Agree to All consent policy.',
            409,
          );
        submitted = true;
        await execution.beforeExternalMutation();
        // Forward the UI-generated request exactly once at the Playwright transport layer.
        // Chromium may replay a POST after an empty connection close even with one UI click.
        const response = await route.fetch({
          maxRetries: 0,
          maxRedirects: 0,
          timeout: this.options.responseTimeoutMs ?? 15000,
        });
        if (response.ok()) {
          const created = parseResponse(signupSchema, await response.json());
          state = await this.options.store.mutate(execution, (current) => ({
            ...current!,
            confirmed: {
              serviceUserId: created.serviceUserId,
              createdAt: new Date().toISOString(),
            },
          }));
        }
        await route.fulfill({ response });
      } catch (error) {
        await route.abort('blockedbyclient').catch(() => {});
        rejectGate(
          error instanceof AppError
            ? error
            : new AppError(
                'WEVERSE_SIGNUP_TRANSPORT_ERROR',
                'The final signup response was not confirmed. Review the external outcome before retrying.',
                502,
              ),
        );
      }
    };
    await ctx.context.route(gatePattern, gate);
    try {
      const service = network.capture(paths.service, 'GET');
      const entry = new URL('/en/signup', this.site.accountOrigin);
      entry.search = new URLSearchParams({
        client_id: 'weverse',
        redirect_uri: this.site.redirectUri,
        redirect_method: 'COOKIE',
      }).toString();
      await view.open(entry.href);
      const capabilities = parseResponse(serviceSchema, (await service).body);
      if (!capabilities.authMethods.signup.some((method) => method.toLowerCase() === 'email'))
        throw new AppError(
          'WEVERSE_SIGNUP_UNAVAILABLE',
          'Email signup is unavailable for this service.',
          422,
        );
      await view.fillIdentity(state.identity);
      await view.disableOverseasBlock();
      await this.stage(execution, 'overseas_signin_allowed');
      if (config.weverse?.timeZone) await view.timeZone(config.weverse.timeZone);
      await this.stage(execution, 'signup_ready');
      // Every newly reconstructed browser form gets a fresh OTP session. Existing email tracking
      // must not supply a code for a different remote otpSessionId.
      const code = await ctx.waitForOtp(
        state.identity.email,
        this.options.otpSender,
        async (recipient) => {
          if (recipient !== state.identity.email)
            throw new AppError(
              'ACCOUNT_DOMAIN_MISMATCH',
              'OTP recipient differs from the active identity.',
              422,
            );
          const sessionWait = network.capture(paths.otp);
          const sendWait = network.capture(paths.send);
          const [sessionResponse, sendResponse] = await Promise.all([
            sessionWait,
            sendWait,
            view.sendOtp(),
          ]);
          const session = parseResponse(otpSchema, sessionResponse.body);
          const sent = parseResponse(sendSchema, sendResponse.body);
          if (
            sessionResponse.request.email !== recipient ||
            sendResponse.request.otpSessionId !== session.otpSessionId ||
            sendResponse.path !== `${paths.otp}/${encodeURIComponent(session.otpSessionId)}/send`
          )
            throw new AppError(
              'WEVERSE_OTP_SESSION_MISMATCH',
              'OTP dispatch did not match the active recipient/session.',
              409,
            );
          state = await this.options.store.mutate(execution, (current) => ({
            ...current!,
            otp: {
              sessionId: session.otpSessionId,
              expiresAt: new Date(Date.now() + sent.expiresIn * 1000).toISOString(),
            },
          }));
          await this.stage(execution, 'otp_requested');
          return { expiresAt: new Date(state.otp!.expiresAt) };
        },
        300,
        { fresh: true },
      );
      if (!state.otp || new Date(state.otp.expiresAt) <= new Date())
        throw new AppError('OTP_TIMEOUT', 'The remote OTP session expired.', 422);
      await this.stage(execution, 'otp_received');
      const authWait = network.capture(paths.auth);
      const [authResponse] = await Promise.all([authWait, view.verifyOtp(code)]);
      if (
        authResponse.request.email !== state.identity.email ||
        authResponse.request.otpSessionId !== state.otp.sessionId ||
        authResponse.request.otpCode !== code
      )
        throw new AppError(
          'WEVERSE_OTP_SESSION_MISMATCH',
          'OTP verification did not match the active session.',
          409,
        );
      const auth = parseResponse(authSchema, authResponse.body);
      state = await this.options.store.mutate(execution, (current) => ({
        ...current!,
        otp: {
          ...current!.otp!,
          authCode: auth.authCode,
          authExpiresAt: new Date(auth.expiredAt).toISOString(),
        },
      }));
      await this.stage(execution, 'email_verified');
      const badWordsWait = network.capture(paths.badWords);
      const termsWait = network.capture(paths.terms, 'GET');
      const [badWordsResponse] = await Promise.all([badWordsWait, view.next()]);
      if (
        badWordsResponse.request.text !== state.identity.username ||
        parseResponse(z.object({ containsBadWords: z.boolean() }), badWordsResponse.body)
          .containsBadWords
      )
        throw new AppError('WEVERSE_NICKNAME_REJECTED', 'The selected nickname was rejected.', 422);
      const termsResponse = await termsWait;
      agreements = flattenTerms(parseResponse(termsSchema, termsResponse.body));
      await view.consent(agreements);
      await this.stage(execution, 'consent_ready');
      const signupWait = network.capture(paths.signup);
      submitArmed = true;
      const [response] = await Promise.all([
        Promise.race([signupWait, gateFailure]),
        view.submit(),
      ]);
      const created = parseResponse(signupSchema, response.body);
      // The request gate journaled success before fulfilling the browser response.
      if (state.confirmed?.serviceUserId !== created.serviceUserId)
        throw new AppError(
          'WEVERSE_PROTOCOL_CHANGED',
          'The browser response differs from the confirmed signup journal.',
          502,
        );
      let authenticated = false;
      try {
        await this.options.event?.(execution, 'task.weverse.signup_confirmed');
        const validateWait = network.capture(paths.validate, 'GET', 5000);
        const [validation] = await Promise.all([validateWait, view.complete()]);
        const result = parseResponse(
          z.object({
            serviceUserId: z.string(),
            expiresIn: z.number().positive(),
            refreshRequired: z.boolean(),
          }),
          validation.body,
        );
        authenticated =
          result.serviceUserId === created.serviceUserId &&
          validation.authorization === `Bearer ${created.accessToken}` &&
          !result.refreshRequired;
        const destination = new URL(ctx.page.url());
        if (destination.origin !== new URL(this.site.redirectUri).origin) authenticated = false;
      } catch {
        /* Confirmed accounts remain successful even when session bootstrap fails. */
      }
      await this.options
        .event?.(
          execution,
          authenticated ? 'task.weverse.authenticated' : 'task.weverse.session_unverified',
        )
        .catch(() => {});
      return this.result(state, authenticated);
    } finally {
      // Keep the deny handler installed until the executor closes this exclusive context.
      // Removing it could allow the frontend to replay a final mutation during cleanup.
      submitArmed = false;
    }
  }
}
