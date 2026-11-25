import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { taxFor, taxLabel } from '../products/product-tax.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CheckoutService } from './checkout.service.js';

describe('product tax rules', () => {
  it('included, percent or fixed per item', () => {
    expect(taxFor({ taxIncluded: true, taxType: 'percent', taxValue: 20 }, 10, 2)).toBe(0);
    expect(taxFor({ taxIncluded: false, taxType: 'percent', taxValue: 20 }, 10, 2)).toBe(4);
    expect(taxFor({ taxIncluded: false, taxType: 'fixed', taxValue: 1.5 }, 10, 3)).toBe(4.5);
    expect(taxLabel({ taxIncluded: true })).toBe('Tax included');
    expect(taxLabel({ taxIncluded: false, taxType: 'percent', taxValue: 20 })).toBe('+ 20% tax');
    expect(taxLabel({ taxIncluded: false, taxType: 'fixed', taxValue: 1.5 })).toBe('+ £1.50 tax per item');
  });
});

function makeService(product: Record<string, unknown>, couponPercent = 0) {
  const prisma = {
    cmsSection: { findUnique: vi.fn().mockResolvedValue(null) },
    product: { findFirst: vi.fn().mockResolvedValue({ id: 'db-1', name: 'Matcha', price: 20, image: '', stockStatus: 'In Stock', archivedAt: null, ...product }), findMany: vi.fn().mockResolvedValue([]) },
    coupon: {
      findUnique: vi.fn().mockResolvedValue(
        couponPercent
          ? { code: 'ALL', discountPercent: couponPercent, isActive: true, generateDate: '2000-01-01', expiredDate: '2999-12-31', customerRange: 0, uses: 0, archivedAt: null }
          : null,
      ),
    },
  };
  return new CheckoutService(prisma as unknown as PrismaService, { get: vi.fn(() => null) } as unknown as ConfigService);
}
const line = { productId: 'db-1', sizeIndex: 0, months: 1, qty: 2 }; // 2 × 250g = 500g → France £13.95 band

describe('CheckoutService — tax', () => {
  it('adds tax on top for products that do not include it', async () => {
    const pricing = await makeService({ taxIncluded: false, taxType: 'percent', taxValue: 20 }).calculatePricing({ lines: [line], shippingAddress: { country: 'France' } });
    expect(pricing.tax).toBe(pricing.subtotal * 0.2);
    expect(pricing.total).toBeCloseTo(pricing.subtotal + 13.95 + pricing.tax, 2);
  });

  it('tax is never discounted: a 100% coupon leaves delivery + tax to pay', async () => {
    const pricing = await makeService({ taxIncluded: false, taxType: 'fixed', taxValue: 1.5 }, 100).calculatePricing({
      lines: [line],
      shippingAddress: { country: 'France' },
      promoCode: 'ALL',
    });
    expect(pricing.tax).toBe(3);
    expect(pricing.total).toBe(16.95);
  });

  it('no tax line for tax-included products', async () => {
    expect((await makeService({ taxIncluded: true, taxValue: 20 }).calculatePricing({ lines: [line] })).tax).toBe(0);
  });
});

describe('CheckoutService — delivery by packed weight', () => {
  const options = [
    { id: 'small', label: '60 capsules', price: 20, interval: 'month', intervalCount: 1, weightGrams: 120 },
    { id: 'big', label: '240 capsules', price: 60, interval: 'month', intervalCount: 4, weightGrams: 600 },
  ];
  const service = () => makeService({ taxIncluded: true, supplyOptions: options });

  it('uses the weight set on the chosen supply option', async () => {
    const light = await service().calculatePricing({ lines: [{ ...line, qty: 2, optionId: 'small' }], shippingAddress: { country: 'France' } });
    expect(light.weightGrams).toBe(240);
    expect(light.shipping).toBe(10.95);
    const heavy = await service().calculatePricing({ lines: [{ ...line, qty: 1, optionId: 'big' }], shippingAddress: { country: 'United States' } });
    expect(heavy.weightGrams).toBe(600);
    expect(heavy.shipping).toBe(24.95);
  });

  it('UK is free at any weight; over 2kg abroad is refused with the quote message', async () => {
    const uk = await service().calculatePricing({ lines: [{ ...line, qty: 3, optionId: 'big' }], shippingAddress: { country: 'United Kingdom' } });
    expect(uk.shipping).toBe(0);
    await expect(
      service().calculatePricing({ lines: [{ ...line, qty: 4, optionId: 'big' }], shippingAddress: { country: 'France' } }),
    ).rejects.toThrow(/quote/i);
  });
});
