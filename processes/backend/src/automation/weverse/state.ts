import { z } from 'zod';
import type { ExecutionContext } from '../../queue/executor.js';
export const weverseStateSchema = z.object({
  version: z.literal(1),
  configHash: z.string().length(64),
  identity: z.object({
    email: z.string().email(),
    username: z.string().min(1).max(32),
    password: z.string().min(8).max(32),
  }),
  otp: z
    .object({
      sessionId: z.string(),
      expiresAt: z.string().datetime(),
      authCode: z.string().optional(),
      authExpiresAt: z.string().datetime().optional(),
    })
    .optional(),
  confirmed: z
    .object({ serviceUserId: z.string().min(1), createdAt: z.string().datetime() })
    .optional(),
});
export type WeverseState = z.infer<typeof weverseStateSchema>;
export interface WeverseStateStore {
  read(execution: ExecutionContext): Promise<WeverseState | undefined>;
  mutate(
    execution: ExecutionContext,
    update: (state: WeverseState | undefined) => WeverseState,
  ): Promise<WeverseState>;
}
