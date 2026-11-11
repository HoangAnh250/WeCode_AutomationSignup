import { setTimeout as delay } from 'node:timers/promises';
import type { EmailManager } from '../services/email.service.js';
import type { ExecutionContext } from '../queue/executor.js';
import { verificationSchema } from '../contracts/schemas.js';
import { AppError } from '../core/errors.js';
export interface OtpDispatchReceipt {
  expiresAt: Date;
}
export type WaitForOtp = (
  recipient: string,
  sender: string,
  requestOtp: (accountEmail: string) => Promise<void | OtpDispatchReceipt>,
  ttlSeconds?: number,
  options?: { fresh?: boolean },
) => Promise<string>;
export class EmailVerificationCoordinator {
  constructor(
    private readonly email: EmailManager,
    private readonly pollMs = 2000,
  ) {}
  bind(
    execution: ExecutionContext,
    emailConfigId: string | null,
    accountDomain: string,
  ): WaitForOtp {
    return async (recipient, sender, requestOtp, ttlSeconds = 300, options = {}) => {
      await execution.assertCanContinue();
      if (!emailConfigId)
        throw new AppError(
          'MAILBOX_REQUIRED',
          'Configure a separate OTP inbox before requesting verification.',
          422,
        );
      const input = verificationSchema.parse({ recipient, sender, ttlSeconds });
      if (input.recipient.split('@')[1] !== accountDomain.toLowerCase())
        throw new AppError(
          'ACCOUNT_DOMAIN_MISMATCH',
          'OTP recipient must be the generated account email.',
          422,
        );
      const checkpoint =
        execution.checkpoint &&
        typeof execution.checkpoint === 'object' &&
        !Array.isArray(execution.checkpoint)
          ? (execution.checkpoint as Record<string, unknown>)
          : {};
      const previous = checkpoint.emailVerification as
        | { id?: string; recipient?: string; sender?: string; dispatch?: 'sending' | 'sent' }
        | undefined;
      let record: Awaited<ReturnType<EmailManager['status']>> | undefined;
      if (
        !options.fresh &&
        previous?.dispatch !== 'sending' &&
        previous?.id &&
        previous.recipient === input.recipient &&
        previous.sender === input.sender
      ) {
        try {
          const candidate = await this.email.status(previous.id);
          if (
            candidate.emailConfigId === emailConfigId &&
            candidate.recipient === input.recipient &&
            candidate.sender === input.sender &&
            candidate.expiresAt > new Date()
          )
            record = candidate;
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error;
        }
      }
      if (!record) {
        const created = await this.email.createVerification(emailConfigId, input);
        record = await this.email.status(created.id);
        await execution.saveCheckpoint({
          emailVerification: {
            id: record.id,
            recipient: input.recipient,
            sender: input.sender,
            dispatch: 'sending',
          },
        });
        await execution.assertCanContinue();
        const receipt = await requestOtp(input.recipient);
        if (receipt) await this.email.limitVerificationExpiry(record.id, receipt.expiresAt);
        record = await this.email.status(record.id);
        await execution.saveCheckpoint({
          emailVerification: {
            id: record.id,
            recipient: input.recipient,
            sender: input.sender,
            dispatch: 'sent',
          },
        });
      }
      while (record.expiresAt > new Date()) {
        await execution.assertCanContinue();
        const state = await this.email.scan(record.id);
        if (state.status === 'detected') {
          await execution.assertCanContinue();
          return this.email.code(record.id);
        }
        if (state.status === 'ambiguous')
          throw new AppError(
            'OTP_AMBIGUOUS',
            'Multiple matching OTPs were found; do not guess a code.',
            409,
            false,
          );
        if (state.status === 'expired') break;
        try {
          await delay(
            Math.min(this.pollMs, Math.max(1, record.expiresAt.getTime() - Date.now())),
            undefined,
            { signal: execution.signal },
          );
        } catch {
          await execution.assertCanContinue();
          throw new AppError('OTP_WAIT_ABORTED', 'OTP monitoring was interrupted.', 503, true);
        }
      }
      throw new AppError(
        'OTP_TIMEOUT',
        'No matching OTP arrived before the request expired.',
        504,
        false,
      );
    };
  }
}
