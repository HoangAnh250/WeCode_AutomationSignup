import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  emailConfigSchema,
  emailUpdateSchema,
  verificationSchema,
} from '../contracts/schemas.js';
import type { EmailRepository } from '../repositories/email.repository.js';
import { emailPublic } from '../repositories/email.repository.js';
import type { SecretCipher } from '../core/crypto.js';
import type { MailGateway, MailConnection } from '../infrastructure/imap.gateway.js';
import { AppError, conflict, notFound } from '../core/errors.js';
import { audit } from '../core/events.js';
import { matchVerification } from '../lib/otp.js';
export class EmailManager {
  constructor(
    private readonly repo: EmailRepository,
    private readonly cipher: SecretCipher,
    private readonly gateway: MailGateway,
  ) {}
  list() {
    return this.repo.list();
  }
  async appPassword(id: string) {
    const record = await this.repo.get(id);
    if (!record) throw notFound('Mailbox');
    return this.cipher.open(record.appPasswordCipher, `mailbox:${id}`);
  }
  async create(input: z.infer<typeof emailConfigSchema>) {
    const id = randomUUID();
    const { appPassword, ...fields } = input;
    const record = await this.repo.db.emailConfig.create({
      data: {
        id,
        ...fields,
        appPasswordCipher: this.cipher.seal(
          input.host.toLowerCase() === 'imap.gmail.com'
            ? appPassword.replace(/\s/g, '')
            : appPassword,
          `mailbox:${id}`,
        ),
      },
      select: emailPublic,
    });
    await audit(this.repo.db, 'mailbox.created', id);
    return record;
  }
  async update(id: string, input: z.infer<typeof emailUpdateSchema>) {
    return this.repo.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM email_configs WHERE id=${id}::uuid FOR UPDATE`;
      const config = await tx.emailConfig.findUnique({ where: { id } });
      if (!config) throw notFound('Mailbox');
      if (config.version !== input.version)
        throw conflict('Mailbox configuration changed. Refresh before saving.');
      const { version, appPassword, ...fields } = input;
      const connectionChanged =
        Boolean(appPassword) ||
        (['inboxAddress', 'host', 'port', 'mailbox'] as const).some(
          (key) => fields[key] !== undefined && fields[key] !== config[key],
        );
      const result = await tx.emailConfig.update({
        where: { id },
        data: {
          ...fields,
          appPasswordCipher: appPassword
            ? this.cipher.seal(
                (fields.host ?? config.host).toLowerCase() === 'imap.gmail.com'
                  ? appPassword.replace(/\s/g, '')
                  : appPassword,
                `mailbox:${id}`,
              )
            : undefined,
          status: connectionChanged ? 'unknown' : undefined,
          lastCheckedAt: connectionChanged ? null : undefined,
          version: { increment: 1 },
        },
        select: emailPublic,
      });
      await audit(tx, 'mailbox.updated', id);
      return result;
    });
  }
  private async connection(id: string): Promise<{ config: MailConnection; version: number }> {
    const c = await this.repo.get(id);
    if (!c) throw notFound('Mailbox');
    return {
      config: {
        inboxAddress: c.inboxAddress,
        host: c.host,
        port: c.port,
        mailbox: c.mailbox,
        appPassword: this.cipher.open(c.appPasswordCipher, `mailbox:${id}`),
      },
      version: c.version,
    };
  }
  async test(id: string) {
    const { config, version } = await this.connection(id);
    try {
      await this.gateway.test(config);
      await this.repo.db.emailConfig.updateMany({
        where: { id, version },
        data: { status: 'connected', lastCheckedAt: new Date() },
      });
      return { connected: true };
    } catch {
      await this.repo.db.emailConfig.updateMany({
        where: { id, version },
        data: { status: 'disconnected', lastCheckedAt: new Date() },
      });
      throw new AppError(
        'IMAP_CONNECTION_FAILED',
        'Mailbox connection failed. Check TLS host, port and App Password.',
        502,
        true,
      );
    }
  }
  async createVerification(id: string, input: z.infer<typeof verificationSchema>) {
    const mailbox = await this.repo.get(id);
    if (!mailbox) throw notFound('Mailbox');
    if (
      mailbox.accountDomain &&
      input.recipient.split('@')[1].toLowerCase() !== mailbox.accountDomain
    )
      throw new AppError(
        'ACCOUNT_DOMAIN_MISMATCH',
        'Verification recipient must use the configured account domain, not the inbox address.',
        422,
      );
    const request = await this.repo.db.verificationRequest.create({
      data: {
        emailConfigId: id,
        mailbox: mailbox.mailbox,
        recipient: input.recipient,
        sender: input.sender,
        expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
      },
    });
    const { codeCipher, ...safe } = request;
    return safe;
  }
  async limitVerificationExpiry(id: string, expiresAt: Date) {
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())
      throw new AppError('OTP_TIMEOUT', 'Remote verification has expired.', 422);
    await this.repo.db.verificationRequest.updateMany({
      where: { id, expiresAt: { gt: expiresAt } },
      data: { expiresAt },
    });
  }
  async verifications(emailConfigId: string) {
    if (!(await this.repo.get(emailConfigId))) throw notFound('Mailbox');
    await this.repo.db.verificationRequest.updateMany({
      where: {
        emailConfigId,
        expiresAt: { lte: new Date() },
        status: { in: ['waiting', 'ambiguous', 'detected'] },
      },
      data: { status: 'expired', codeCipher: null },
    });
    return this.repo.db.verificationRequest.findMany({
      where: { emailConfigId },
      select: {
        id: true,
        recipient: true,
        sender: true,
        status: true,
        requestedAt: true,
        expiresAt: true,
      },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    });
  }
  async status(id: string) {
    const v = await this.repo.db.verificationRequest.findUnique({
      where: { id },
      select: {
        id: true,
        emailConfigId: true,
        recipient: true,
        sender: true,
        status: true,
        requestedAt: true,
        expiresAt: true,
      },
    });
    if (!v) throw notFound('Verification');
    return v;
  }
  async scan(id: string) {
    const v = await this.repo.db.verificationRequest.findUnique({ where: { id } });
    if (!v) throw notFound('Verification');
    if (v.expiresAt <= new Date()) {
      await this.repo.db.verificationRequest.update({
        where: { id },
        data: { status: 'expired', codeCipher: null },
      });
      return this.status(id);
    }
    if (v.status === 'detected') return this.status(id);
    const { config } = await this.connection(v.emailConfigId);
    let messages;
    try {
      messages = await this.gateway.scan({ ...config, mailbox: v.mailbox }, v.requestedAt);
    } catch {
      throw new AppError('IMAP_SCAN_FAILED', 'Mailbox scan could not be completed.', 502, true);
    }
    const matches = matchVerification(messages, v.recipient, v.sender, v.requestedAt, v.expiresAt);
    if (matches.length !== 1 || !matches[0].code) {
      if (matches.length)
        await this.repo.db.verificationRequest.updateMany({
          where: { id, status: { not: 'detected' } },
          data: { status: 'ambiguous' },
        });
      return this.status(id);
    }
    const match = matches[0];
    try {
      await this.repo.db.verificationRequest.updateMany({
        where: { id, status: { not: 'detected' }, expiresAt: { gt: new Date() } },
        data: {
          status: 'detected',
          uid: match.message.uid,
          uidValidity: match.message.uidValidity,
          codeCipher: this.cipher.seal(match.code!, `otp:${id}`),
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        throw conflict('This email has already been matched to another verification request.');
      throw error;
    }
    return this.status(id);
  }
  async code(id: string) {
    const v = await this.repo.db.verificationRequest.findUnique({ where: { id } });
    if (!v) throw notFound('Verification');
    if (v.expiresAt <= new Date() || v.status !== 'detected' || !v.codeCipher)
      throw conflict('No unexpired, unambiguous code is available.');
    await audit(this.repo.db, 'verification.code_revealed', id);
    return this.cipher.open(v.codeCipher, `otp:${id}`);
  }
}
