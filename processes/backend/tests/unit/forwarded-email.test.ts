import { describe, it, expect } from 'vitest';
import { parseMailCandidate } from '../../src/infrastructure/imap.gateway.js';
import { matchVerification, extractOtp } from '../../src/lib/otp.js';
const at = new Date('2026-01-01T12:00:01Z');
async function mail(headers: string, body = 'Verification code 123456.') {
  return parseMailCandidate(
    Buffer.from(
      `From: no-reply@example.test\r\nTo: alo123@gmail.com\r\n${headers}\r\nSubject: Verify account\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`,
    ),
    { uid: '10', uidValidity: '1', receivedAt: at },
  );
}
describe('forwarded OTP original-recipient matching', () => {
  it.each([
    'X-Original-To',
    'Delivered-To',
    'X-Envelope-To',
    'Original-Recipient',
    'X-Forwarded-To',
  ])(
    'matches original recipient in %s without treating Gmail as signup identity',
    async (header) => {
      const parsed = await mail(`${header}: Alex123@mytic.website\r\n`);
      expect(parsed.recipients).toContain('alex123@mytic.website');
      expect(
        matchVerification(
          [parsed],
          'alex123@mytic.website',
          'no-reply@example.test',
          new Date(at.getTime() - 1000),
          new Date(at.getTime() + 1000),
        )[0]?.code,
      ).toBe('123456');
      expect(
        matchVerification(
          [parsed],
          'john888@mytic.website',
          'no-reply@example.test',
          new Date(at.getTime() - 1000),
          new Date(at.getTime() + 1000),
        ),
      ).toHaveLength(0);
    },
  );
  it('does not derive a recipient from body text or a similar domain', async () => {
    const parsed = await mail(
      'X-Original-To: alex123@mytic.website.evil\r\n',
      'For alex123@mytic.website: code 123456.',
    );
    expect(parsed.recipients).not.toContain('alex123@mytic.website');
  });
  it('retains repeated forwarded headers', async () => {
    const parsed = await mail(
      'Delivered-To: alo123@gmail.com\r\nDelivered-To: alex123@mytic.website\r\n',
    );
    expect(parsed.recipients).toEqual(
      expect.arrayContaining(['alo123@gmail.com', 'alex123@mytic.website']),
    );
  });
});

describe('OTP extraction from verification mail with tracking links', () => {
  it('ignores tracking URL identifiers, wrapped policy links and addresses', () => {
    const text =
      'Verification Code 123456\nTerms of Use\n[https://tracking.example/policy/abcdef-000000/abc\n]\nPrivacy https://tracking.example/000000/footer\nContact 654321@example.test';
    expect(extractOtp(text)).toEqual(['123456']);
  });
  it('retains genuine ambiguity in visible message content', () => {
    expect(extractOtp('Verification Code 123456 or 654321.')).toEqual(['123456', '654321']);
  });
  it('does not combine two independent matching messages into one candidate', async () => {
    const first = await mail(
      'X-Original-To: alex123@mytic.website\r\n',
      'Verification Code 123456.',
    );
    const second = { ...first, uid: '11', text: 'Verification Code 654321.' };
    expect(
      matchVerification(
        [first, second],
        'alex123@mytic.website',
        'no-reply@example.test',
        new Date(at.getTime() - 1000),
        new Date(at.getTime() + 1000),
      ),
    ).toHaveLength(2);
  });
});
