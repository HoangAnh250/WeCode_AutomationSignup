import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AesSecretCipher } from '../../src/core/crypto.js';
import { CatchallManager, generatePassword } from '../../src/services/identity.service.js';
import { identitySchema, passwordPolicySchema } from '../../src/contracts/schemas.js';
import { parseProxyImport, normalizeProxy } from '../../src/lib/proxy-parser.js';
import { csvCell } from '../../src/services/export.service.js';
import { extractOtp, matchVerification } from '../../src/lib/otp.js';
import type { MailCandidate } from '../../src/infrastructure/imap.gateway.js';
describe('secret storage', () => {
  it('encrypts with random IV and rejects tampering or wrong purpose', () => {
    const cipher = new AesSecretCipher(randomBytes(32).toString('base64'));
    const one = cipher.seal('private-password', 'account:1'),
      two = cipher.seal('private-password', 'account:1');
    expect(one).not.toBe(two);
    expect(one).not.toContain('private-password');
    expect(cipher.open(one, 'account:1')).toBe('private-password');
    expect(() => cipher.open(one, 'account:2')).toThrow();
    const bits = one.split('.');
    bits[3] = Buffer.from('corrupted').toString('base64');
    expect(() => cipher.open(bits.join('.'), 'account:1')).toThrow();
  });
});
describe('catchall identity generation', () => {
  it.each(['[random][digits]', '[firstName][digits]', '[word][digits]'] as const)(
    'supports %s and enforces password classes',
    (pattern) => {
      const rows = new CatchallManager().generate(
        identitySchema.parse({ domain: 'nam.fit', pattern, count: 40 }),
      );
      expect(new Set(rows.map((x) => x.email)).size).toBe(40);
      for (const row of rows) {
        expect(row.email).toBe(`${row.username}@nam.fit`);
        expect(row.username).toMatch(/^[a-z]+\d{4}$/);
        expect(row.password).toHaveLength(20);
        expect(row.password).toMatch(/[A-Z]/);
        expect(row.password).toMatch(/[a-z]/);
        expect(row.password).toMatch(/[0-9]/);
        expect(row.password).toMatch(/[!@#$%&*+_-]/);
      }
    },
  );
  it('rejects empty character classes and domains containing a URL', () => {
    expect(
      passwordPolicySchema.safeParse({
        uppercase: false,
        lowercase: false,
        numbers: false,
        special: false,
      }).success,
    ).toBe(false);
    expect(identitySchema.safeParse({ domain: 'https://nam.fit' }).success).toBe(false);
  });
});
describe('proxy import', () => {
  it('normalizes all requested formats and IPv6', () => {
    expect(normalizeProxy('proxy.example:8080')).toMatchObject({
      protocol: 'http',
      host: 'proxy.example',
      port: 8080,
    });
    expect(normalizeProxy('proxy.example:8080:user:pass:with:colon').password).toBe(
      'pass:with:colon',
    );
    expect(normalizeProxy('socks5://u:p@proxy.example:1080').protocol).toBe('socks5');
    expect(normalizeProxy('https://proxy.example:8443').port).toBe(8443);
    expect(normalizeProxy('http://proxy.example').port).toBe(80);
    expect(normalizeProxy('[::1]:8080').host).toBe('::1');
  });
  it('reports invalid lines, deduplicates and redacts JSON parse errors', () => {
    const result = parseProxyImport(
      'proxy.test:80\nproxy.test:80\nnot-a-proxy\nproxy.test:99999',
      'txt',
    );
    expect(result.valid).toHaveLength(1);
    expect(result.duplicates).toBe(1);
    expect(result.errors).toHaveLength(2);
    expect(() => parseProxyImport('SECRET-password', 'json')).toThrow('Invalid import structure');
  });
  it('parses CSV with a BOM and quoted password', () => {
    const result = parseProxyImport(
      '\uFEFFhost,port,username,password\r\nproxy.test,3128,user,"pass,word"',
      'csv',
    );
    expect(result.valid[0]).toMatchObject({ host: 'proxy.test', password: 'pass,word' });
  });
  it('rejects dangerous CSV columns and unsupported protocols', () => {
    const result = parseProxyImport('__proto__,host,port\nanything,proxy.test,8080', 'csv');
    expect(result.valid).toHaveLength(0);
    expect(() => normalizeProxy('ftp://proxy.test:21')).toThrow();
    expect(() => normalizeProxy('http://proxy.test:80/path')).toThrow();
  });
});
describe('OTP correlation', () => {
  const now = new Date();
  const message: MailCandidate = {
    uid: '1',
    uidValidity: '99',
    receivedAt: now,
    sender: ['no-reply@weverse.example'],
    recipients: ['alex123@nam.fit'],
    text: 'Your verification code is 123456.',
  };
  it('matches only the exact intended recipient, sender and time window', () => {
    const future = new Date(now.getTime() + 300000);
    expect(
      matchVerification([message], 'alex123@nam.fit', 'no-reply@weverse.example', now, future),
    ).toHaveLength(1);
    expect(
      matchVerification([message], 'john888@nam.fit', 'no-reply@weverse.example', now, future),
    ).toHaveLength(0);
    expect(
      matchVerification([message], 'alex123@nam.fit', 'attacker@example.test', now, future),
    ).toHaveLength(0);
    expect(
      matchVerification(
        [message],
        'alex123@nam.fit',
        'no-reply@weverse.example',
        new Date(now.getTime() + 1),
        future,
      ),
    ).toHaveLength(0);
  });
  it('marks multiple codes as ambiguous instead of guessing', () => {
    const row = matchVerification(
      [{ ...message, text: '123456 or 987654' }],
      'alex123@nam.fit',
      'no-reply@weverse.example',
      now,
      new Date(now.getTime() + 1000),
    );
    expect(row[0].code).toBeNull();
    expect(extractOtp('Code 123456. Repeated: 123456.')).toEqual(['123456']);
  });
});
describe('spreadsheet safety', () => {
  it.each(['=SUM(A1)', '+cmd', '-1+2', '@formula', '  =SUM(A1)', '\t=cmd'])(
    'neutralizes %s in CSV',
    (value) => expect(csvCell(value)).toMatch(/^"'/),
  );
  it('escapes quotes and preserves ordinary values', () => {
    expect(csvCell('name,"quoted"')).toBe('"name,""quoted"""');
    expect(csvCell('alex@nam.fit')).toBe('"alex@nam.fit"');
  });
});
