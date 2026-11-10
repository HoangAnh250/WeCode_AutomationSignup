import { randomInt } from 'node:crypto';
import type { z } from 'zod';
import { identitySchema, passwordPolicySchema } from '../contracts/schemas.js';
import { AppError } from '../core/errors.js';
const firstNames = [
  'alex',
  'john',
  'maya',
  'lena',
  'noah',
  'emma',
  'liam',
  'olivia',
  'lucas',
  'ava',
];
const words = [
  'river',
  'forest',
  'cedar',
  'ocean',
  'meadow',
  'maple',
  'silver',
  'cloud',
  'harbor',
  'willow',
];
function sample(chars: string, length: number) {
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join('');
}
export function generatePassword(policy: z.infer<typeof passwordPolicySchema>) {
  const groups = [
    policy.uppercase ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : '',
    policy.lowercase ? 'abcdefghijkmnopqrstuvwxyz' : '',
    policy.numbers ? '23456789' : '',
    policy.special ? '!@#$%&*+-_' : '',
  ].filter(Boolean);
  if (!groups.length || policy.length < groups.length)
    throw new AppError('INVALID_PASSWORD_POLICY', 'Password policy cannot be satisfied.', 422);
  const chars = groups.join('');
  const result = groups.map((g) => sample(g, 1));
  while (result.length < policy.length) result.push(sample(chars, 1));
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.join('');
}
export class CatchallManager {
  generate(input: z.infer<typeof identitySchema>) {
    const used = new Set<string>();
    return Array.from({ length: input.count }, () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const stem =
          input.pattern === '[firstName][digits]'
            ? firstNames[randomInt(firstNames.length)]
            : input.pattern === '[word][digits]'
              ? words[randomInt(words.length)]
              : sample('abcdefghijklmnopqrstuvwxyz', input.randomLength);
        const username = stem + sample('0123456789', input.digits);
        const email = `${username}@${input.domain}`;
        if (email.length > 254)
          throw new AppError(
            'IDENTITY_TOO_LONG',
            'The resulting email exceeds the supported address length.',
            422,
          );
        if (used.has(username)) continue;
        used.add(username);
        return { username, email, password: generatePassword(input.password) };
      }
      throw new AppError('IDENTITY_COLLISION', 'Pattern space is too small for this batch.', 422);
    });
  }
}
