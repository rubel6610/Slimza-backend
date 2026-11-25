import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOYALTY_CONFIG } from '../loyalty/loyalty-config.js';
import { planRedemption } from '../loyalty/loyalty-rules.js';
import type { LoyaltyService } from '../loyalty/loyalty.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CheckoutService } from './checkout.service.js';

function makeService(balance: number) {
  const prisma = {
    cmsSection: { findUnique: vi.fn().mockResolvedValue(null) },
    product: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    coupon: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const loyalty = {
    getRedeemContext: vi.fn().mockResolvedValue({ config: DEFAULT_LOYALTY_CONFIG, balance, lifetime: 0 }),
    planRedemption: (...args: Parameters<typeof planRedemption>) => planRedemption(...args),
  };
  return new CheckoutService(
    prisma as unknown as PrismaService,
    { get: vi.fn(() => null) } as unknown as ConfigService,
    undefined,
    loyalty as unknown as LoyaltyService,
  );
}

// p01 = £27.99 (static catalogue), France tracked delivery (Zone 1, up to 250g) £10.95
const line = { productId: 'p01', sizeIndex: 0, months: 1, qty: 1 };

describe('CheckoutService — loyalty points', () => {
  it('takes points off the products, not the delivery', async () => {
    const pricing = await makeService(1000).calculatePricing(
      { lines: [line], shippingAddress: { country: 'France' }, pointsToRedeem: 500, userId: 'u1' },
      { strictPoints: true },
    );
    expect(pricing).toMatchObject({ pointsRedeemed: 500, pointsDiscount: 5, total: 33.94, pointsEligibleSpend: 22.99 });
  });

  it('can pay for all the products but never the delivery', async () => {
    const pricing = await makeService(99999).calculatePricing(
      { lines: [line], shippingAddress: { country: 'France' }, pointsToRedeem: 99999, userId: 'u1' },
      { strictPoints: false },
    );
    expect(pricing).toMatchObject({ pointsRedeemed: 2799, pointsDiscount: 27.99, total: 10.95 });
  });

  it('refuses at the payment step when the request is not possible', async () => {
    await expect(
      makeService(100).calculatePricing({ lines: [line], pointsToRedeem: 500, userId: 'u1' }, { strictPoints: true }),
    ).rejects.toThrow(/You have 100 points/);
    await expect(
      makeService(1000).calculatePricing({ lines: [line], pointsToRedeem: 500, userId: null }, { strictPoints: true }),
    ).rejects.toThrow(/Sign in/);
  });

  it('never fails a paid order: uses what is possible at confirmation', async () => {
    const pricing = await makeService(100).calculatePricing(
      { lines: [line], pointsToRedeem: 500, userId: 'u1' },
      { strictPoints: false },
    );
    expect(pricing).toMatchObject({ pointsRedeemed: 100, pointsDiscount: 1 });
  });
});
