import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUNDLE_CONFIG,
  parseBundleConfigForSave,
  readBundleConfig,
  type BundleConfig,
} from './bundle-config.js';
import { bundleRuleError, discountPercentFor, priceBundle, tierForUnits, type BundleProductInfo } from './bundle-pricing.js';

const product = (id: string, category: string, price = 10, originalPrice: number | null = null): BundleProductInfo => ({
  id,
  name: id,
  image: '',
  price,
  originalPrice,
  category,
});

const config = (patch: Partial<BundleConfig> = {}): BundleConfig => ({
  ...DEFAULT_BUNDLE_CONFIG,
  ...patch,
  rules: { ...DEFAULT_BUNDLE_CONFIG.rules, ...(patch.rules ?? {}) },
  discounts: { ...DEFAULT_BUNDLE_CONFIG.discounts, ...(patch.discounts ?? {}) },
});

describe('bundle tiers', () => {
  it('applies the highest tier reached (2 → 5%, 3 → 10%, 4+ → 15%)', () => {
    const c = config();
    expect(tierForUnits(c, 1)).toBeNull();
    expect(tierForUnits(c, 2)?.percent).toBe(5);
    expect(tierForUnits(c, 3)?.percent).toBe(10);
    expect(tierForUnits(c, 9)?.percent).toBe(15);
  });

  it('ignores archived tiers', () => {
    const c = config({
      tiers: [
        { id: 'a', minItems: 2, percent: 5, archivedAt: null },
        { id: 'b', minItems: 3, percent: 50, archivedAt: '2026-11-01T00:00:00Z' },
      ],
    });
    expect(tierForUnits(c, 3)?.percent).toBe(5);
  });

  it('prices a bundle with quantities', () => {
    const priced = priceBundle(config(), [
      { product: product('a', 'tea', 10), qty: 2 },
      { product: product('b', 'coffee', 20), qty: 1 },
    ]);
    expect(priced).toMatchObject({ units: 3, subtotal: 40, percent: 10, discount: 4, total: 36 });
  });

  it('uses the regular price when "use sale price" is off', () => {
    const lines = [
      { product: product('a', 'tea', 8, 10), qty: 1 },
      { product: product('b', 'tea', 10), qty: 1 },
    ];
    expect(priceBundle(config(), lines).subtotal).toBe(18);
    expect(priceBundle(config({ discounts: { ...DEFAULT_BUNDLE_CONFIG.discounts, useSalePrice: false } }), lines).subtotal).toBe(20);
  });
});

describe('bundle rules', () => {
  it('enforces minimum and maximum items', () => {
    const c = config({ rules: { ...DEFAULT_BUNDLE_CONFIG.rules, minItems: 2, maxItems: 3 } });
    expect(bundleRuleError(c, [{ product: product('a', 'tea'), qty: 1 }])).toMatch(/at least 2/);
    expect(bundleRuleError(c, [{ product: product('a', 'tea'), qty: 4 }])).toMatch(/at most 3/);
    expect(bundleRuleError(c, [{ product: product('a', 'tea'), qty: 2 }])).toBeNull();
  });

  it('limits how many items come from one category', () => {
    const c = config({ rules: { ...DEFAULT_BUNDLE_CONFIG.rules, perCategoryLimit: 1 } });
    const lines = [
      { product: product('a', 'tea'), qty: 1 },
      { product: product('b', 'tea'), qty: 1 },
    ];
    expect(bundleRuleError(c, lines, () => 'Tea')).toMatch(/at most 1 item from Tea/);
    expect(
      bundleRuleError(c, [
        { product: product('a', 'tea'), qty: 1 },
        { product: product('c', 'coffee'), qty: 1 },
      ]),
    ).toBeNull();
  });

  it('rejects products outside the allowed categories or excluded', () => {
    const c = config({ rules: { ...DEFAULT_BUNDLE_CONFIG.rules, categories: ['tea'], excludedProductIds: ['x'] } });
    expect(bundleRuleError(c, [{ product: product('a', 'coffee'), qty: 2 }])).toMatch(/can't be added/);
    expect(bundleRuleError(c, [{ product: product('x', 'tea'), qty: 2 }])).toMatch(/can't be added/);
  });
});

describe('bundle config', () => {
  it('rejects invalid saves with readable messages', () => {
    const result = parseBundleConfigForSave({
      ...DEFAULT_BUNDLE_CONFIG,
      tiers: [
        { id: 'a', minItems: 2, percent: 5 },
        { id: 'b', minItems: 2, percent: 10 },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/both start at 2 items/);
  });

  it('reads partial or broken stored data safely', () => {
    expect(readBundleConfig(null)).toEqual(DEFAULT_BUNDLE_CONFIG);
    expect(readBundleConfig({ rules: { perCategoryLimit: 2 } }).rules.perCategoryLimit).toBe(2);
    expect(readBundleConfig({ rules: { minItems: 'oops' } })).toEqual(DEFAULT_BUNDLE_CONFIG);
  });
});

describe('discount growth and cap', () => {
  const growing = config({
    tiers: [
      { id: 'a', minItems: 2, percent: 5, archivedAt: null },
      { id: 'b', minItems: 3, percent: 10, archivedAt: null },
    ],
    discounts: { useSalePrice: true, allowCoupons: true, extraPercentPerItem: 5, maxPercent: 25 },
  });

  it('keeps adding % per extra product after the last tier, up to the cap', () => {
    expect([2, 3, 4, 5, 6, 7, 20].map((n) => discountPercentFor(growing, n))).toEqual([5, 10, 15, 20, 25, 25, 25]);
  });

  it('caps plain tiers too', () => {
    const c = config({ discounts: { ...DEFAULT_BUNDLE_CONFIG.discounts, maxPercent: 12 } });
    expect(discountPercentFor(c, 4)).toBe(12);
  });

  it('allows unlimited quantity per product when the limit is 0', () => {
    const c = config({ rules: { ...DEFAULT_BUNDLE_CONFIG.rules, maxQtyPerProduct: 0 } });
    expect(bundleRuleError(c, [{ product: product('a', 'tea'), qty: 500 }])).toBeNull();
    expect(priceBundle(growing, [{ product: product('a', 'tea', 10), qty: 50 }])).toMatchObject({ percent: 25, total: 375 });
  });
});
