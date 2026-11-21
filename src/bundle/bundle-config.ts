/**
 * ============================================================================
 *  MAKE YOUR OWN BUNDLE — settings managed from the dashboard (Bundle page)
 * ============================================================================
 *
 * Stored as the CMS section `bundle` (table `CmsSection`, key "bundle"), so the
 * storefront receives it with every other CMS section from `GET /cms`, and the
 * dashboard saves it with `PUT /cms/bundle`. Saves are validated with
 * `bundleConfigSchema` (400 on invalid input, see CmsService.updateSection).
 *
 * Checkout never trusts the browser's bundle prices: CheckoutService re-reads
 * these settings and the products from the database and re-applies the rules
 * (src/bundle/bundle-pricing.ts).
 *
 * Discount tiers are archivable CMS items (path `tiers`, see cms-archive.ts):
 * the dashboard archives a tier instead of deleting it. Archived tiers never
 * apply to pricing.
 */
import { z } from 'zod';

/** "Buy `minItems` or more products in one bundle, get `percent`% off that bundle." */
export const bundleTierSchema = z.object({
  id: z.string().trim().min(1).max(100),
  minItems: z.number().int().min(2, 'A tier needs at least 2 items').max(100),
  percent: z.number().min(0.01, 'Discount must be more than 0%').max(90, 'Discount can be at most 90%'),
  archivedAt: z.string().nullable().optional(),
});
export type BundleTier = z.infer<typeof bundleTierSchema>;

const text = (max: number) => z.string().trim().max(max);

export const bundleConfigSchema = z
  .object({
    /** Off = the /bundle page shows "unavailable" and checkout rejects bundles. */
    enabled: z.boolean(),

    /** Page copy. */
    page: z.object({
      title: text(120),
      subtitle: text(300),
      productsHeading: text(80),
      builderHeading: text(80),
      note: text(500),
    }),

    /** The banner at the top of /bundle (replaces the old image-only banner). */
    banner: z.object({
      active: z.boolean(),
      badge: text(40),
      title: text(160),
      subtitle: text(300),
      /** Optional background image; empty = solid brand green. */
      imageUrl: text(1000),
      ctaLabel: text(40),
      ctaHref: text(300),
      /** Show the discount tiers as chips inside the banner. */
      showTiers: z.boolean(),
      /** false = image-only banner (no badge/title/subtitle/chips/button on top). */
      showText: z.boolean(),
    }),

    rules: z.object({
      /** Fewest products (counting quantities) a bundle may contain. */
      minItems: z.number().int().min(1).max(100),
      /** Most products in one bundle. 0 = no limit. */
      maxItems: z.number().int().min(0).max(200),
      /** Most products from the same category in one bundle. 0 = no limit. */
      perCategoryLimit: z.number().int().min(0).max(100),
      /** Most of one product in a bundle. 0 = no limit. */
      maxQtyPerProduct: z.number().int().min(0).max(1000),
      /** Category slugs customers can pick from. Empty = every category. */
      categories: z.array(z.string().trim().min(1).max(100)).max(100),
      /** Product ids hidden from the bundle builder. */
      excludedProductIds: z.array(z.string().trim().min(1).max(100)).max(500),
    }),

    /** Quantity discounts. The highest tier the bundle reaches applies. */
    tiers: z.array(bundleTierSchema).max(20),

    /** How bundles interact with the shop's normal discounts. */
    discounts: z.object({
      /** true = bundle items use the product's sale price; false = its regular (original) price. */
      useSalePrice: z.boolean(),
      /** true = coupon codes also reduce bundles; false = coupons only apply to non-bundle items. */
      allowCoupons: z.boolean(),
      /**
       * After the last tier, every extra product adds this many % (0 = off).
       * e.g. tiers 2→5%, 3→10% with 5 here: 4→15%, 5→20%, …
       */
      extraPercentPerItem: z.number().min(0).max(90),
      /** Highest bundle discount a customer can get, in % (0 = no cap; never above 90). */
      maxPercent: z.number().min(0).max(90),
    }),

    /** Optional flat reward: spend `threshold` on bundles → `amount` off the order. */
    spendReward: z.object({
      enabled: z.boolean(),
      threshold: z.number().min(0).max(100000),
      amount: z.number().min(0).max(10000),
    }),
  })
  .superRefine((config, ctx) => {
    const { minItems, maxItems } = config.rules;
    if (maxItems > 0 && maxItems < minItems) {
      ctx.addIssue({
        code: 'custom',
        path: ['rules', 'maxItems'],
        message: 'Maximum items must be 0 (no limit) or at least the minimum items',
      });
    }
    const seen = new Set<string>();
    const seenMin = new Set<number>();
    config.tiers.forEach((tier, i) => {
      if (seen.has(tier.id)) {
        ctx.addIssue({ code: 'custom', path: ['tiers', i, 'id'], message: `Duplicate tier id "${tier.id}"` });
      }
      seen.add(tier.id);
      if (!tier.archivedAt) {
        if (seenMin.has(tier.minItems)) {
          ctx.addIssue({
            code: 'custom',
            path: ['tiers', i, 'minItems'],
            message: `Two active tiers both start at ${tier.minItems} items`,
          });
        }
        seenMin.add(tier.minItems);
      }
    });
  });

export type BundleConfig = z.infer<typeof bundleConfigSchema>;

export const BUNDLE_CMS_KEY = 'bundle';

export const DEFAULT_BUNDLE_CONFIG: BundleConfig = {
  enabled: true,
  page: {
    title: 'Build your bundle',
    subtitle: 'Mix & match your favourites into one bundle, and save more the more you add.',
    productsHeading: 'Our products',
    builderHeading: 'Build your bundle',
    note: 'Pick the products you love and use QTY to choose how many of each.',
  },
  banner: {
    active: true,
    badge: 'Bundle & save',
    title: 'The more you bundle, the more you save',
    subtitle: 'Discount applies automatically to your bundle.',
    imageUrl: '',
    ctaLabel: '',
    ctaHref: '',
    showTiers: true,
    showText: true,
  },
  rules: {
    minItems: 2,
    maxItems: 0,
    perCategoryLimit: 0,
    maxQtyPerProduct: 10,
    categories: [],
    excludedProductIds: [],
  },
  tiers: [
    { id: 'tier-2', minItems: 2, percent: 5, archivedAt: null },
    { id: 'tier-3', minItems: 3, percent: 10, archivedAt: null },
    { id: 'tier-4', minItems: 4, percent: 15, archivedAt: null },
  ],
  discounts: {
    useSalePrice: true,
    allowCoupons: true,
    extraPercentPerItem: 0,
    maxPercent: 0,
  },
  spendReward: {
    enabled: false,
    threshold: 500,
    amount: 5,
  },
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Lenient read: stored data merged over the defaults, section by section.
 * Used when *reading* (checkout), so a partially saved / older config never
 * breaks pricing. Falls back to the defaults if the result is still invalid.
 */
export function readBundleConfig(raw: unknown): BundleConfig {
  if (!isObject(raw)) return DEFAULT_BUNDLE_CONFIG;
  const merged = {
    ...DEFAULT_BUNDLE_CONFIG,
    ...raw,
    page: { ...DEFAULT_BUNDLE_CONFIG.page, ...(isObject(raw.page) ? raw.page : {}) },
    banner: { ...DEFAULT_BUNDLE_CONFIG.banner, ...(isObject(raw.banner) ? raw.banner : {}) },
    rules: { ...DEFAULT_BUNDLE_CONFIG.rules, ...(isObject(raw.rules) ? raw.rules : {}) },
    discounts: { ...DEFAULT_BUNDLE_CONFIG.discounts, ...(isObject(raw.discounts) ? raw.discounts : {}) },
    spendReward: { ...DEFAULT_BUNDLE_CONFIG.spendReward, ...(isObject(raw.spendReward) ? raw.spendReward : {}) },
    tiers: Array.isArray(raw.tiers) ? raw.tiers : DEFAULT_BUNDLE_CONFIG.tiers,
  };
  const parsed = bundleConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_BUNDLE_CONFIG;
}

/** Strict parse for dashboard saves. Returns the data or a readable error list. */
export function parseBundleConfigForSave(
  raw: unknown,
): { ok: true; data: BundleConfig } | { ok: false; message: string } {
  const parsed = bundleConfigSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const message = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'bundle'}: ${issue.message}`)
    .join('; ');
  return { ok: false, message };
}
