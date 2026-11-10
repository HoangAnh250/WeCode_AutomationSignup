import { z } from 'zod';
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).default(''),
});
export type PageInput = z.infer<typeof pageSchema>;
export const offset = (input: PageInput) => ({
  skip: (input.page - 1) * input.limit,
  take: input.limit,
});
