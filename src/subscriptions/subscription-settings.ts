/**
 * Subscribe & Save settings — CMS section "subscriptions" (Dashboard → Order management →
 * Subscriptions → Settings).
 *
 * Client brief (28 Nov): the customer picks a supply (1 / 2 / 3 month…), then One-time purchase or
 * Subscribe & Save. A subscription renews as often as its supply lasts (a 2-month supply is charged
 * and delivered every 2 months) — there is no separate frequency to choose. Every recurring payment
 * gets "X% off": the store-wide % below, or the package's own % when it has one (Dashboard →
 * Products → Purchase options). The first order is at the normal price unless "discount on the
 * first order" is on. Renewals keep the coupon the first order used, so the price never jumps up.
 */
import { z } from 'zod';
import type { SupplyOption } from '../products/supply-options.js';

export const SUBSCRIPTION_SETTINGS_KEY = 'subscriptions';

export const subscriptionSettingsSchema = z.object({
  /** Turn Subscribe & Save on or off for the whole shop */
  enabled: z.boolean(),
  /** Deliveries a customer must receive before they can cancel (1 = cancel any time) */
  minOrders: z.coerce.number().int().min(1).max(12),
  /** "Save 15%" — taken off every recurring payment (after the header coupon), unless the package has its own % */
  discountPercent: z.coerce.number().min(0).max(90).optional().default(15),
  /** Also take it off the first order? Off = the first order is at the normal price (client brief). */
  discountOnFirstOrder: z.boolean().optional().default(false),
});
export type SubscriptionSettings = z.infer<typeof subscriptionSettingsSchema>;

export const DEFAULT_SUBSCRIPTION_SETTINGS: SubscriptionSettings = {
  enabled: true,
  minOrders: 1,
  discountPercent: 15,
  discountOnFirstOrder: false,
};

export function readSubscriptionSettings(raw: unknown): SubscriptionSettings {
  const parsed = subscriptionSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SUBSCRIPTION_SETTINGS;
}

export function parseSubscriptionSettingsForSave(raw: unknown): { ok: true; data: SubscriptionSettings } | { ok: false; message: string } {
  const parsed = subscriptionSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `${issue.message}${issue.path.length ? ` (${issue.path.join('.')})` : ''}` };
  }
  return { ok: true, data: parsed.data };
}

/** The Subscribe & Save % for one package: its own % when set, else the store-wide one. */
export function subscribePercentFor(option: Pick<SupplyOption, 'subscribeDiscountOverride'>, settings: Pick<SubscriptionSettings, 'discountPercent'>): number {
  return option.subscribeDiscountOverride ?? settings.discountPercent;
}

/** Text customers see before subscribing. */
export function commitmentText(minOrders: number): string {
  return minOrders <= 1
    ? 'Cancel any time.'
    : `Minimum ${minOrders} deliveries, then cancel any time.`;
}
