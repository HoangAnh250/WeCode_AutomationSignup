import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
export interface MailConnection {
  inboxAddress: string;
  appPassword: string;
  host: string;
  port: number;
  mailbox?: string;
}
export interface MailCandidate {
  uid: string;
  uidValidity: string;
  receivedAt: Date;
  sender: string[];
  recipients: string[];
  text: string;
}
export interface MailGateway {
  test(config: MailConnection): Promise<void>;
  scan(config: MailConnection, since: Date): Promise<MailCandidate[]>;
}
function addresses(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(addresses);
  if (value && typeof value === 'object') {
    const p = value as { address?: string; value?: unknown };
    return p.address ? [p.address.toLowerCase()] : addresses(p.value);
  }
  return [];
}
export async function parseMailCandidate(
  source: Buffer,
  meta: { uid: string; uidValidity: string; receivedAt: Date; envelope?: unknown },
): Promise<MailCandidate> {
  const parsed = await simpleParser(source, {
    skipHtmlToText: false,
    skipTextToHtml: true,
    skipImageLinks: true,
  });
  const accepted = new Set([
    'delivered-to',
    'x-original-to',
    'envelope-to',
    'x-envelope-to',
    'x-forwarded-to',
    'original-recipient',
  ]);
  const headers = parsed.headerLines
    .filter((header) => accepted.has(header.key.toLowerCase()))
    .flatMap(
      (header) =>
        header.line.toLowerCase().match(/[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+/g) ?? [],
    );
  const envelope = meta.envelope as { from?: unknown; to?: unknown; cc?: unknown } | undefined;
  return {
    uid: meta.uid,
    uidValidity: meta.uidValidity,
    receivedAt: meta.receivedAt,
    sender: addresses(envelope?.from ?? parsed.from),
    recipients: [
      ...new Set([
        ...addresses(envelope?.to),
        ...addresses(envelope?.cc),
        ...addresses(parsed.to),
        ...addresses(parsed.cc),
        ...headers,
      ]),
    ],
    text: parsed.text ?? '',
  };
}
export class ImapGateway implements MailGateway {
  private create(config: MailConnection) {
    const c = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: true,
      auth: { user: config.inboxAddress, pass: config.appPassword },
      logger: false,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      disableAutoIdle: true,
    });
    c.on('error', () => {});
    return c;
  }
  async test(config: MailConnection) {
    const c = this.create(config);
    try {
      await c.connect();
      const lock = await c.getMailboxLock(config.mailbox ?? 'INBOX', { readOnly: true });
      lock.release();
    } finally {
      try {
        await c.logout();
      } catch {
        c.close();
      }
    }
  }
  async scan(config: MailConnection, since: Date) {
    const c = this.create(config);
    try {
      await c.connect();
      const lock = await c.getMailboxLock(config.mailbox ?? 'INBOX', { readOnly: true });
      try {
        const found = await c.search({ since }, { uid: true });
        const ids = (found || []).slice(-100);
        if (!ids.length) return [];
        const metadata = await c.fetchAll(
          ids,
          { envelope: true, internalDate: true, size: true },
          { uid: true },
        );
        const result: MailCandidate[] = [];
        for (const meta of metadata) {
          const date =
            meta.internalDate instanceof Date
              ? meta.internalDate
              : new Date(String(meta.internalDate));
          if (
            !Number.isFinite(date.getTime()) ||
            date < since ||
            !meta.size ||
            meta.size > 2_000_000
          )
            continue;
          const full = await c.fetchOne(meta.uid, { source: true }, { uid: true });
          if (!full || !full.source) continue;
          result.push(
            await parseMailCandidate(full.source, {
              uid: String(meta.uid),
              uidValidity: String(c.mailbox ? c.mailbox.uidValidity : ''),
              receivedAt: date,
              envelope: meta.envelope,
            }),
          );
        }
        return result;
      } finally {
        lock.release();
      }
    } finally {
      try {
        await c.logout();
      } catch {
        c.close();
      }
    }
  }
}
