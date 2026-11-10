import type { MailCandidate } from '../infrastructure/imap.gateway.js';
export function extractOtp(text: string): string[] {
  const codes = new Set<string>();
  const expression = /\b\d{6}\b/g;
  for (const m of text.matchAll(expression)) codes.add(m[0]);
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
