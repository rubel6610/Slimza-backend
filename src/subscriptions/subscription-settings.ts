/**
 * Subscribe & Save settings — CMS section "subscriptions" (Dashboard → Order management →
 * Subscriptions → Settings). Per-product discounts live on the product's supply options.
 */
import { z } from 'zod';

export const SUBSCRIPTION_SETTINGS_KEY = 'subscriptions';

export const subscriptionSettingsSchema = z.object({
  /** Turn Subscribe & Save on or off for the whole shop */
  enabled: z.boolean(),
  /** Deliveries a customer must receive before they can cancel (1 = cancel any time) */
  minOrders: z.coerce.number().int().min(1).max(12),
});
export type SubscriptionSettings = z.infer<typeof subscriptionSettingsSchema>;

export const DEFAULT_SUBSCRIPTION_SETTINGS: SubscriptionSettings = { enabled: true, minOrders: 2 };

export function readSubscriptionSettings(raw: unknown): SubscriptionSettings {
  const parsed = subscriptionSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SUBSCRIPTION_SETTINGS;
}

export function parseSubscriptionSettingsForSave(raw: unknown): { ok: true; data: SubscriptionSettings } | { ok: false; message: string } {
  const parsed = subscriptionSettingsSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, message: `${issue.message}${issue.path.length ? ` (${issue.path.join('.')})` : ''}` };
}

/** Text customers see before subscribing. */
export function commitmentText(minOrders: number): string {
  return minOrders <= 1
    ? 'Cancel any time.'
    : `Minimum ${minOrders} deliveries, then cancel any time.`;
}
