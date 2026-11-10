import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export interface SecretCipher {
  seal(value: string, purpose: string): string;
  open(value: string, purpose: string): string;
}
export class AesSecretCipher implements SecretCipher {
  private readonly key: Buffer;
  constructor(base64: string) {
    this.key = Buffer.from(base64, 'base64');
    if (this.key.length !== 32) throw new Error('Invalid encryption key.');
  }
  seal(value: string, purpose: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(purpose));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [
      'v1',
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      encrypted.toString('base64'),
    ].join('.');
  }
  open(value: string, purpose: string) {
    const [version, iv, tag, payload, ...rest] = value.split('.');
    if (version !== 'v1' || !iv || !tag || payload === undefined || rest.length)
      throw new Error('Invalid encrypted value.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
