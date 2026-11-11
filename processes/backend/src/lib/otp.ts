import type { MailCandidate } from '../infrastructure/imap.gateway.js';
export function extractOtp(text: string): string[] {
  const codes = new Set<string>();
  const expression = /\b\d{6}\b/g;
  // mailparser's HTML-to-text output retains tracking links, sometimes wrapped across lines.
  // Numbers in those destinations are not verification-code candidates.
  const content = text
    .replace(/\[(?:https?:\/\/|www\.)[\s\S]*?\]/gi, ' ')
    .replace(/<(?:https?:\/\/|www\.)[^>]*>/gi, ' ')
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>\]]+/gi, ' ')
    .replace(/[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+/gi, ' ');
  for (const m of content.matchAll(expression)) codes.add(m[0]);
  return [...codes];
}
export function matchVerification(
  messages: MailCandidate[],
  recipient: string,
  sender: string,
  since: Date,
  expiresAt: Date,
) {
  return messages
    .filter(
      (m) =>
        m.receivedAt >= since &&
        m.receivedAt <= expiresAt &&
        m.recipients.includes(recipient.toLowerCase()) &&
        m.sender.includes(sender.toLowerCase()),
    )
    .flatMap<{ message: MailCandidate; code: string | null }>((message) => {
      const codes = extractOtp(message.text);
      return codes.length === 1
        ? [{ message, code: codes[0] }]
        : codes.length > 1
          ? [{ message, code: null }]
          : [];
    });
}
