import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import type { WalletService } from '../wallet/wallet.service.js';
import { CheckoutService } from './checkout.service.js';

function makeService(balance: number) {
  const prisma = {
    cmsSection: { findUnique: vi.fn().mockResolvedValue(null) },
    product: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    coupon: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const wallet = { balance: vi.fn().mockResolvedValue(balance), cardsEnabled: false };
  return new CheckoutService(
    prisma as unknown as PrismaService,
    { get: vi.fn(() => null) } as unknown as ConfigService,
    undefined,
    undefined,
    wallet as unknown as WalletService,
  );
}

// p01 = £27.99 (static catalogue), express delivery £4.99 → £32.98
const line = { productId: 'p01', sizeIndex: 0, months: 1, qty: 1 };

describe('CheckoutService — store credit', () => {
  it('pays part of the order; the card is charged the rest', async () => {
    const pricing = await makeService(10).calculatePricing({ lines: [line], shippingMethodId: 'uk-express', userId: 'u1', useWallet: true });
    expect(pricing).toMatchObject({ total: 32.98, walletUsed: 10, amountDue: 22.98, totalInPence: 2298 });
  });

  it('can pay for everything, delivery included', async () => {
    const pricing = await makeService(100).calculatePricing({ lines: [line], shippingMethodId: 'uk-express', userId: 'u1', useWallet: true });
    expect(pricing).toMatchObject({ total: 32.98, walletUsed: 32.98, amountDue: 0, totalInPence: 0 });
  });

  it('is only used when asked, and only for signed-in customers', async () => {
    expect((await makeService(100).calculatePricing({ lines: [line], userId: 'u1' })).walletUsed).toBe(0);
    expect((await makeService(100).calculatePricing({ lines: [line], userId: null, useWallet: true })).walletUsed).toBe(0);
  });

  it('a fully-credit order skips the card', async () => {
    const service = makeService(100);
    const res = await service.createPaymentIntent(
      {
        lines: [line],
        bundles: [],
        shippingMethodId: 'uk-standard',
        pointsToRedeem: 0,
        useWallet: true,
        saveCard: false,
        shippingAddress: { name: 'Sam', email: 'sam@example.com', phone: '07700900123', line1: '1 High St', line2: '', city: 'Leeds', district: '', postcode: 'LS1 1AA', country: 'United Kingdom', deliveryNotes: '' },
      },
      'u1',
      'CUSTOMER',
    );
    expect(res).toMatchObject({ mode: 'wallet', clientSecret: null, paymentIntentId: null, pricing: { amountDue: 0 } });
    expect(res.pricing.walletUsed).toBe(res.pricing.total);
  });
});
