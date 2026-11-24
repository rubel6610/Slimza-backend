import { z } from 'zod';
import { pageParamsSchema } from '../common/pagination/pagination.js';
import { MAX_ADJUSTMENT } from './wallet-rules.js';

export const walletHistoryQuerySchema = pageParamsSchema.omit({ q: true }).extend({
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});
export type WalletHistoryQuery = z.infer<typeof walletHistoryQuerySchema>;

/** Stripe PaymentMethod id (pm_1Abc…) or, in test mode, a saved card's uuid. */
export const cardIdParamSchema = z
  .string()
  .trim()
  .regex(/^(pm_[A-Za-z0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/, 'Unknown card');

/**
 * Test mode (no Stripe): save a card to the wallet. Only what a receipt shows — the browser sends
 * brand / last 4 / expiry, never the card number or CVC.
 */
export const addTestCardSchema = z.object({
  brand: z.enum(['Visa', 'Mastercard', 'American Express', 'Discover', 'Card']),
  last4: z.string().trim().regex(/^\d{4}$/, 'Last 4 digits'),
  expMonth: z.coerce.number().int().min(1).max(12),
  expYear: z.coerce.number().int().min(2000).max(2100),
  makeDefault: z.boolean().optional().default(false),
});
export type AddTestCardInput = z.infer<typeof addTestCardSchema>;
export const userIdParamSchema = z.string().trim().min(1).max(64);

/** Admin: add (positive) or remove (negative) store credit. */
export const adminAdjustSchema = z.object({
  amount: z.coerce
    .number()
    .refine((n) => Number.isFinite(n) && n !== 0, 'Enter an amount other than 0')
    .refine((n) => Math.abs(n) <= MAX_ADJUSTMENT, `Adjust at most £${MAX_ADJUSTMENT} at a time`)
    .transform((n) => Math.round(n * 100) / 100),
  reason: z.string().trim().min(3, 'Add a short reason (the customer sees it)').max(200),
});
export type AdminAdjustInput = z.infer<typeof adminAdjustSchema>;
