import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BUNDLE_CONFIG, type BundleConfig } from '../bundle/bundle-config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CheckoutService } from './checkout.service.js';

const dbProduct = (id: string, category: string, price: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Product ${id}`,
  image: `/img/${id}.png`,
  price,
  originalPrice: null,
  category,
  publishStatus: 'published',
  stockStatus: 'In Stock',
  unlimitedStock: false,
  archivedAt: null,
  ...extra,
});

const PRODUCTS = [
  dbProduct('tea1', 'tea', 10),
  dbProduct('tea2', 'tea', 20, { originalPrice: 25 }),
  dbProduct('cof1', 'coffee', 30),
  dbProduct('gone', 'tea', 10, { archivedAt: new Date() }),
];

function makeService(config: Partial<BundleConfig> = {}) {
  const bundle = { ...DEFAULT_BUNDLE_CONFIG, ...config };
  const prisma = {
    product: {
      findMany: vi.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(PRODUCTS.filter((p) => where.id.in.includes(p.id))),
      ),
      findFirst: vi.fn(),
    },
    cmsSection: {
      findUnique: vi.fn(({ where }: { where: { key: string } }) =>
        Promise.resolve(
          where.key === 'bundle'
            ? { key: 'bundle', data: bundle }
            : { key: 'categories', data: [{ slug: 'tea', name: 'Tea' }] },
        ),
      ),
    },
    coupon: {
      findUnique: vi.fn().mockResolvedValue({
        code: 'SAVE10',
        discountPercent: 10,
        isActive: true,
        expiredDate: new Date(Date.now() + 86_400_000),
        generateDate: new Date(Date.now() - 86_400_000),
        customerRange: 100,
        uses: 0,
        archivedAt: null,
      }),
    },
  };
  const configService = { get: vi.fn(() => null) };
  return new CheckoutService(prisma as unknown as PrismaService, configService as unknown as ConfigService);
}

const bundle = (items: Array<[string, number]>, qty = 1) => ({
  items: items.map(([productId, q]) => ({ productId, qty: q })),
  qty,
});

describe('CheckoutService — make your own bundle', () => {
  it('prices from the database and applies the tier (3 items → 10%)', async () => {
    const pricing = await makeService().calculatePricing({
      bundles: [bundle([['tea1', 2], ['cof1', 1]])],
    });
    // (10×2 + 30) = 50, 10% off = 45
    expect(pricing.subtotal).toBe(45);
    expect(pricing.bundleSavings).toBe(5);
    expect(pricing.lineItems[0]).toMatchObject({ isBundle: true, unitPrice: 45, totalPrice: 45 });
    expect(pricing.lineItems[0].bundleData).toMatchObject({ discountPercent: 10, subtotal: 50 });
  });

  it('multiplies by the bundle quantity', async () => {
    const pricing = await makeService().calculatePricing({ bundles: [bundle([['tea1', 1], ['cof1', 1]], 2)] });
    // (10 + 30) × 0.95 = 38 per bundle × 2
    expect(pricing.subtotal).toBe(76);
  });

  it('enforces the per-category limit with the category name', async () => {
    const service = makeService({ rules: { ...DEFAULT_BUNDLE_CONFIG.rules, perCategoryLimit: 1, oneProductPerCategory: false } });
    await expect(
      service.calculatePricing({ bundles: [bundle([['tea1', 1], ['tea2', 1]])] }),
    ).rejects.toThrow(/at most 1 item from Tea/);
  });

  it('rejects too-small bundles, archived products and disabled bundles', async () => {
    await expect(makeService().calculatePricing({ bundles: [bundle([['tea1', 1]])] })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      makeService().calculatePricing({ bundles: [bundle([['tea1', 1], ['gone', 1]])] }),
    ).rejects.toThrow(/no longer available/);
    await expect(
      makeService({ enabled: false }).calculatePricing({ bundles: [bundle([['tea1', 1], ['cof1', 1]])] }),
    ).rejects.toThrow(/not available/);
  });

  it('uses the regular price when "use sale price" is off', async () => {
    const service = makeService({ discounts: { ...DEFAULT_BUNDLE_CONFIG.discounts, useSalePrice: false } });
    const pricing = await service.calculatePricing({ bundles: [bundle([['tea2', 1], ['cof1', 1]])] });
    // (25 + 30) × 0.95
    expect(pricing.subtotal).toBe(52.25);
  });

  it('keeps coupons off bundles when "allow coupons" is off', async () => {
    const on = await makeService().calculatePricing({
      bundles: [bundle([['tea1', 1], ['cof1', 1]])],
      promoCode: 'SAVE10',
    });
    expect(on.discount).toBe(3.8);

    const off = await makeService({ discounts: { ...DEFAULT_BUNDLE_CONFIG.discounts, allowCoupons: false } }).calculatePricing({
      bundles: [bundle([['tea1', 1], ['cof1', 1]])],
      promoCode: 'SAVE10',
    });
    expect(off.discount).toBe(0);
    expect(off.promoCode).toBeNull();
  });

  it('refuses a coupon on a bundle-only basket at the payment step when coupons are off', async () => {
    const service = makeService({ discounts: { ...DEFAULT_BUNDLE_CONFIG.discounts, allowCoupons: false } });
    await expect(
      service.calculatePricing({ bundles: [bundle([['tea1', 1], ['cof1', 1]])], promoCode: 'SAVE10' }, { strictPromo: true }),
    ).rejects.toThrow(/can't be used on bundles/);
  });

  it('applies the spend reward only when enabled', async () => {
    const input = { bundles: [bundle([['cof1', 10]])] };
    expect((await makeService().calculatePricing(input)).bundleReward).toBe(0);
    const reward = await makeService({ spendReward: { enabled: true, threshold: 200, amount: 5 } }).calculatePricing(input);
    expect(reward.bundleReward).toBe(5);
  });
});
