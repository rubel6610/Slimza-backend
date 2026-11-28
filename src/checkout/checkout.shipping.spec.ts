import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOYALTY_CONFIG } from '../loyalty/loyalty-config.js';
import { planRedemption } from '../loyalty/loyalty-rules.js';
import type { LoyaltyService } from '../loyalty/loyalty.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CheckoutService } from './checkout.service.js';

/** Rule: the delivery fee is never discounted — coupons and points only reduce the products. */
function makeService(couponPercent: number, points = 0) {
  const coupon = {
    code: 'ALL',
    discountPercent: couponPercent,
    isActive: true,
    generateDate: '2000-01-01',
    expiredDate: '2999-12-31',
    customerRange: 0,
    uses: 0,
    archivedAt: null,
  };
  const prisma = {
    cmsSection: { findUnique: vi.fn().mockResolvedValue(null) },
    // A database product priced £27.99 (products only come from the database).
    product: { findFirst: vi.fn().mockResolvedValue({ id: 'p01', slug: 'p01', name: 'Slimza Detox Elixir', price: 27.99, image: '', stockStatus: 'In Stock', archivedAt: null, supplyOptions: null, subscriptionEnabled: false, taxIncluded: true }), findMany: vi.fn().mockResolvedValue([]) },
    coupon: { findUnique: vi.fn().mockResolvedValue(coupon) },
  };
  const loyalty = {
    getRedeemContext: vi.fn().mockResolvedValue({ config: DEFAULT_LOYALTY_CONFIG, balance: points, lifetime: 0 }),
    planRedemption: (...args: Parameters<typeof planRedemption>) => planRedemption(...args),
  };
  return new CheckoutService(
    prisma as unknown as PrismaService,
    { get: vi.fn(() => null) } as unknown as ConfigService,
    undefined,
    loyalty as unknown as LoyaltyService,
  );
}

// p01 = £27.99 (database product), France tracked delivery (Zone 1, up to 250g) £10.95
const line = { productId: 'p01', sizeIndex: 0, months: 1, qty: 1 };

describe('CheckoutService — delivery is never discounted', () => {
  it('a 100% coupon makes the products free, but delivery is still paid in full', async () => {
    const pricing = await makeService(100).calculatePricing({ lines: [line], shippingAddress: { country: 'France' }, promoCode: 'ALL' });
    expect(pricing.discount).toBe(27.99);
    expect(pricing.total).toBe(10.95);
    expect(pricing.totalInPence).toBe(1095);
  });

  it('coupon + points together never reach the delivery fee', async () => {
    const pricing = await makeService(50, 99999).calculatePricing({
      lines: [line],
      shippingAddress: { country: 'France' },
      promoCode: 'ALL',
      pointsToRedeem: 99999,
      userId: 'u1',
    });
    expect(pricing.total).toBe(10.95);
  });
});
