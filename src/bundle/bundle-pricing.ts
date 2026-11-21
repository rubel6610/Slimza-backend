/**
 * Bundle rules and pricing — pure functions, no database.
 *
 * The storefront has a mirror of this file (Slimza: app/(CommonLayout)/lib/bundle.ts)
 * so customers see the same numbers live; this one is authoritative at checkout.
 * Keep the two in sync when changing a rule.
 *
 *   units      = sum of item quantities in one bundle
 *   unit price = product sale price (`price`), or its regular price
 *                (`originalPrice`) when "use sale price" is off
 *   subtotal   = Σ unit price × qty
 *   tier       = the active tier with the highest `minItems` ≤ units
 *   percent    = tier.percent
 *                + extraPercentPerItem × (units − last tier's minItems)   (only past the last tier)
 *                capped at maxPercent (0 = no cap) and never above 90
 *   discount   = subtotal × percent / 100
 *   total      = subtotal − discount
 */
import type { BundleConfig, BundleTier } from './bundle-config.js';

export interface BundleProductInfo {
  id: string;
  name: string;
  image: string;
  /** Sale price (what the shop charges). */
  price: number;
  /** Regular price before the product's own sale, if any. */
  originalPrice: number | null;
  /** Category slug. */
  category: string;
}

export interface BundleLine {
  product: BundleProductInfo;
  qty: number;
}

export interface PricedBundleResult {
  units: number;
  subtotal: number;
  tier: BundleTier | null;
  percent: number;
  discount: number;
  total: number;
  items: Array<{
    productId: string;
    name: string;
    image: string;
    category: string;
    price: number;
    qty: number;
  }>;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const activeTiers = (config: BundleConfig): BundleTier[] =>
  config.tiers.filter((t) => !t.archivedAt).sort((a, b) => a.minItems - b.minItems);

/** The tier a bundle of `units` products reaches, or null. */
export function tierForUnits(config: BundleConfig, units: number): BundleTier | null {
  let match: BundleTier | null = null;
  for (const tier of activeTiers(config)) if (units >= tier.minItems) match = tier;
  return match;
}

/** Hard ceiling, whatever the settings say. */
export const ABSOLUTE_MAX_PERCENT = 90;

/** The bundle discount in % for `units` products (tiers + growth, capped). */
export function discountPercentFor(config: BundleConfig, units: number): number {
  const tiers = activeTiers(config);
  const tier = tierForUnits(config, units);
  if (!tier) return 0;
  let percent = tier.percent;
  const last = tiers[tiers.length - 1];
  const { extraPercentPerItem, maxPercent } = config.discounts;
  if (extraPercentPerItem > 0 && tier.id === last.id && units > last.minItems) {
    percent += extraPercentPerItem * (units - last.minItems);
  }
  const cap = maxPercent > 0 ? Math.min(maxPercent, ABSOLUTE_MAX_PERCENT) : ABSOLUTE_MAX_PERCENT;
  return Math.round(Math.min(percent, cap) * 100) / 100;
}

export function bundleUnitPrice(config: BundleConfig, product: BundleProductInfo): number {
  if (config.discounts.useSalePrice) return product.price;
  return Math.max(product.price, product.originalPrice ?? product.price);
}

/** Can this product be put in a bundle at all? */
export function isBundleEligible(config: BundleConfig, product: BundleProductInfo): boolean {
  if (config.rules.excludedProductIds.includes(product.id)) return false;
  return config.rules.categories.length === 0 || config.rules.categories.includes(product.category);
}

/**
 * Returns a customer-facing reason the bundle breaks the rules, or null if it is valid.
 * `categoryName` turns a slug into its display name for messages.
 */
export function bundleRuleError(
  config: BundleConfig,
  lines: BundleLine[],
  categoryName: (slug: string) => string = (slug) => slug,
): string | null {
  const { minItems, maxItems, perCategoryLimit, maxQtyPerProduct } = config.rules;
  if (lines.length === 0) return 'Your bundle is empty.';

  const seen = new Set<string>();
  for (const { product, qty } of lines) {
    if (seen.has(product.id)) return `"${product.name}" is in the bundle twice.`;
    seen.add(product.id);
    if (!isBundleEligible(config, product)) return `"${product.name}" can't be added to a bundle.`;
    if (!Number.isInteger(qty) || qty < 1) return `Invalid quantity for "${product.name}".`;
    if (maxQtyPerProduct > 0 && qty > maxQtyPerProduct) return `You can add at most ${maxQtyPerProduct} of "${product.name}" to a bundle.`;
  }

  const units = lines.reduce((sum, l) => sum + l.qty, 0);
  if (units < minItems) return `A bundle needs at least ${minItems} items.`;
  if (maxItems > 0 && units > maxItems) return `A bundle can have at most ${maxItems} items.`;

  if (config.rules.oneProductPerCategory) {
    const picked = new Map<string, string>();
    for (const { product } of lines) {
      const other = picked.get(product.category);
      if (other && other !== product.id) {
        return `Choose one product from ${categoryName(product.category)} per bundle.`;
      }
      picked.set(product.category, product.id);
    }
  }

  if (perCategoryLimit > 0) {
    const perCategory = new Map<string, number>();
    for (const { product, qty } of lines) {
      perCategory.set(product.category, (perCategory.get(product.category) ?? 0) + qty);
    }
    for (const [slug, count] of perCategory) {
      if (count > perCategoryLimit) {
        return `You can pick at most ${perCategoryLimit} item${perCategoryLimit === 1 ? '' : 's'} from ${categoryName(slug)} in one bundle.`;
      }
    }
  }
  return null;
}

/** Prices one bundle. Does not validate; call `bundleRuleError` first. */
export function priceBundle(config: BundleConfig, lines: BundleLine[]): PricedBundleResult {
  const items = lines.map(({ product, qty }) => ({
    productId: product.id,
    name: product.name,
    image: product.image,
    category: product.category,
    price: round2(bundleUnitPrice(config, product)),
    qty,
  }));
  const units = items.reduce((sum, i) => sum + i.qty, 0);
  const subtotal = round2(items.reduce((sum, i) => sum + i.price * i.qty, 0));
  const tier = tierForUnits(config, units);
  const percent = discountPercentFor(config, units);
  const discount = round2((subtotal * percent) / 100);
  return { units, subtotal, tier, percent, discount, total: round2(subtotal - discount), items };
}
