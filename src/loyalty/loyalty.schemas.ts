import { z } from 'zod';

export const socialPlatformParamSchema = z.string().trim().min(1).max(40);

export const adminLoyaltyCustomersQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});
export type AdminLoyaltyCustomersQuery = z.infer<typeof adminLoyaltyCustomersQuerySchema>;

export const adminLoyaltyTransactionsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
});
export type AdminLoyaltyTransactionsQuery = z.infer<typeof adminLoyaltyTransactionsQuerySchema>;

export const adminLoyaltyAdjustSchema = z.object({
  userId: z.string().uuid('Choose a customer'),
  points: z
    .number()
    .int('Whole points only')
    .min(-1_000_000)
    .max(1_000_000)
    .refine((n) => n !== 0, 'Enter a number of points other than 0'),
  reason: z.string().trim().min(3, 'Give a short reason (shown to the customer)').max(200),
});
export type AdminLoyaltyAdjustInput = z.infer<typeof adminLoyaltyAdjustSchema>;
