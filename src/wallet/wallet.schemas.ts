import { z } from 'zod';

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
