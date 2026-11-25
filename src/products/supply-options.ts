/**
 * Supply options (Dashboard → Products → Purchase options), e.g.
 *   "60 – 2 Month Supply" · £16.99 · 2 months
 *   "120 – 4 Month Supply" · £24.99 (was £29.99) · 4 months · "Most popular" · Subscribe & Save 20%
 *
 * One-time purchase: pay the option price once, the whole supply is delivered once.
 * Subscribe & Save: pay the price minus the option's subscription discount; the same supply is
 * delivered and charged again every `intervalCount` × `interval` (supply length = renewal frequency).
 */
import { z } from 'zod';

const round2 = (n: number) => Math.round(n * 100) / 100;

export const supplyOptionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  /** "120 – 4 Month Supply" */
  label: z.string().trim().min(1, 'Every supply option needs a name').max(80),
  /** Length of the supply = how often a subscription renews */
  interval: z.enum(['week', 'month']),
  intervalCount: z.coerce.number().int().min(1).max(52),
  price: z.coerce.number().positive('Price must be above 0').max(100_000),
  /** Shown struck through (optional) */
  compareAtPrice: z.coerce.number().min(0).max(100_000).nullable().optional(),
  /** Servings in this option (optional) → "£0.16 / serving" */
  servings: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
  badge: z.string().trim().max(30).optional().default(''),
  /** Subscribe & Save discount for this option, in % (0 = no subscription discount) */
  subscribeDiscountPercent: z.coerce.number().min(0).max(90).optional().default(0),
  /** Packed weight of one of these, in grams (international shipping is priced by weight). Empty = the default from Dashboard → Shipping. */
  weightGrams: z.coerce.number().int().min(0).max(50_000).nullable().optional(),
});
export type SupplyOption = z.infer<typeof supplyOptionSchema>;

export const supplyOptionsSchema = z
  .array(supplyOptionSchema)
  .max(12)
  .superRefine((options, ctx) => {
    const ids = new Set<string>();
    options.forEach((o, i) => {
      if (ids.has(o.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: 'Duplicate supply option' });
      ids.add(o.id);
    });
  });

/** Tolerant reader for what is stored on a product (bad entries are skipped). */
export function readSupplyOptions(raw: unknown): SupplyOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((o) => {
    const parsed = supplyOptionSchema.safeParse(o);
    return parsed.success ? [parsed.data] : [];
  });
}

export type PurchaseType = 'once' | 'subscription';

/** Price of one pack of this option for the chosen purchase type. */
export function optionUnitPrice(option: SupplyOption, purchase: PurchaseType): number {
  if (purchase !== 'subscription' || !option.subscribeDiscountPercent) return round2(option.price);
  return round2(option.price * (1 - option.subscribeDiscountPercent / 100));
}

/** "every 4 months" / "every 2 weeks" / "every month" */
export function intervalText(option: Pick<SupplyOption, 'interval' | 'intervalCount'>): string {
  const unit = option.interval === 'week' ? 'week' : 'month';
  return option.intervalCount === 1 ? `every ${unit}` : `every ${option.intervalCount} ${unit}s`;
}

/** The date one supply length after `from` (when the next subscription delivery is due). */
export function addInterval(from: Date, option: Pick<SupplyOption, 'interval' | 'intervalCount'>): Date {
  const d = new Date(from);
  if (option.interval === 'week') d.setDate(d.getDate() + 7 * option.intervalCount);
  else d.setMonth(d.getMonth() + option.intervalCount);
  return d;
}

/**
 * The product's shop price ("From £12.74"): the cheapest option, with its "was" price. Products have no
 * price of their own any more — Product.price / originalPrice / discountPercent are kept in step with the
 * options so cards, sorting, the price filter, search and bundles keep working.
 */
export function priceFromOptions(options: SupplyOption[]): { price: number; originalPrice: number | null; discountPercent: number } | null {
  if (!options.length) return null;
  const cheapest = options.reduce((min, o) => (o.price < min.price ? o : min), options[0]);
  const was = cheapest.compareAtPrice && cheapest.compareAtPrice > cheapest.price ? cheapest.compareAtPrice : null;
  return {
    price: round2(cheapest.price),
    originalPrice: was,
    discountPercent: was ? Math.round((1 - cheapest.price / was) * 100) : 0,
  };
}

/** Option used when a basket line doesn't name one (quick add, "Buy again"…): the first option. */
export const fallbackOption = (options: SupplyOption[]): SupplyOption | null => options[0] ?? null;
