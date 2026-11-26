/**
 * Subscribe & Save settings — CMS section "subscriptions" (Dashboard → Order management →
 * Subscriptions → Settings).
 *
 * Client brief (25–26 Nov): customers choose one-time purchase or a monthly subscription; the first
 * order is at the normal price, every recurring payment gets "X% off" (default 15%) automatically;
 * they can pause or cancel any time. Store-wide discount; the frequencies offered are editable
 * (monthly by default — weekly / 2 weeks / 6 months / yearly can be switched on).
 * Renewals keep the coupon the first order used (header coupon), so the price never jumps up.
 */
import { z } from 'zod';

export const SUBSCRIPTION_SETTINGS_KEY = 'subscriptions';

export const frequencySchema = z.object({
  id: z.string().trim().min(1).max(30),
  /** "Every 2 weeks" */
  label: z.string().trim().min(1, 'Every delivery frequency needs a name').max(40),
  /** "Most popular" */
  hint: z.string().trim().max(60).optional().default(''),
  interval: z.enum(['week', 'month']),
  intervalCount: z.coerce.number().int().min(1).max(52),
  active: z.boolean().optional().default(true),
});
export type SubscriptionFrequency = z.infer<typeof frequencySchema>;

export const DEFAULT_FREQUENCIES: SubscriptionFrequency[] = [
  { id: 'month-1', label: 'Every month', hint: 'Most popular', interval: 'month', intervalCount: 1, active: true },
  { id: 'week-1', label: 'Every week', hint: 'Best value for regular users', interval: 'week', intervalCount: 1, active: false },
  { id: 'week-2', label: 'Every 2 weeks', hint: '', interval: 'week', intervalCount: 2, active: false },
  { id: 'month-6', label: 'Every 6 months', hint: '', interval: 'month', intervalCount: 6, active: false },
  { id: 'month-12', label: 'Every year', hint: '', interval: 'month', intervalCount: 12, active: false },
];

export const subscriptionSettingsSchema = z.object({
  /** Turn Subscribe & Save on or off for the whole shop */
  enabled: z.boolean(),
  /** Deliveries a customer must receive before they can cancel (1 = cancel any time) */
  minOrders: z.coerce.number().int().min(1).max(12),
  /** "Save 15%" — taken off every recurring payment (after the header coupon) */
  discountPercent: z.coerce.number().min(0).max(90).optional().default(15),
  /** Also take it off the first order? Off = the first order is at the normal price (client brief). */
  discountOnFirstOrder: z.boolean().optional().default(false),
  /** How often customers can choose to receive it */
  frequencies: z.array(frequencySchema).min(1).max(8).optional().default(DEFAULT_FREQUENCIES),
  /** Pre-selected frequency on the product page */
  defaultFrequencyId: z.string().trim().max(30).optional().default('month-1'),
});
export type SubscriptionSettings = z.infer<typeof subscriptionSettingsSchema>;

export const DEFAULT_SUBSCRIPTION_SETTINGS: SubscriptionSettings = {
  enabled: true,
  minOrders: 1,
  discountPercent: 15,
  discountOnFirstOrder: false,
  frequencies: DEFAULT_FREQUENCIES,
  defaultFrequencyId: 'month-1',
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
  const { frequencies } = parsed.data;
  if (!frequencies.some((f) => f.active)) return { ok: false, message: 'Keep at least one delivery frequency switched on.' };
  if (new Set(frequencies.map((f) => f.id)).size !== frequencies.length) return { ok: false, message: 'Two delivery frequencies have the same id.' };
  return { ok: true, data: parsed.data };
}

/** The frequency a customer picked (or the default / first active one). */
export function pickFrequency(settings: SubscriptionSettings, id?: string | null): SubscriptionFrequency {
  const active = settings.frequencies.filter((f) => f.active);
  return (
    active.find((f) => f.id === id) ??
    active.find((f) => f.id === settings.defaultFrequencyId) ??
    active[0] ??
    DEFAULT_FREQUENCIES[0]
  );
}

/** Text customers see before subscribing. */
export function commitmentText(minOrders: number): string {
  return minOrders <= 1
    ? 'Cancel any time.'
    : `Minimum ${minOrders} deliveries, then cancel any time.`;
}
