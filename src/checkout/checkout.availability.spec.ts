import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { unavailableReason } from '../products/product-availability.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CheckoutService } from './checkout.service.js';

function makeService(stockStatus: string) {
  const product = { id: 'db-1', name: 'Matcha', price: 20, image: '', stockStatus, archivedAt: null };
  const prisma = {
    cmsSection: { findUnique: vi.fn().mockResolvedValue(null) },
    product: { findFirst: vi.fn().mockResolvedValue(product), findMany: vi.fn().mockResolvedValue([]) },
    coupon: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  return new CheckoutService(prisma as unknown as PrismaService, { get: vi.fn(() => null) } as unknown as ConfigService);
}
const line = { productId: 'db-1', sizeIndex: 0, months: 1, qty: 1 };

describe('Coming Soon / Out of Stock products', () => {
  it('knows which products can be bought', () => {
    expect(unavailableReason({ name: 'Tea', stockStatus: 'In Stock' })).toBeNull();
    expect(unavailableReason({ name: 'Tea', stockStatus: 'Low Stock' })).toBeNull();
    expect(unavailableReason({ name: 'Tea', stockStatus: 'Coming Soon' })).toMatch(/coming soon/);
    expect(unavailableReason({ name: 'Tea', stockStatus: 'Out of Stock' })).toMatch(/out of stock/);
  });

  it('checkout refuses them', async () => {
    await expect(makeService('Coming Soon').calculatePricing({ lines: [line] })).rejects.toThrow(/"Matcha" is coming soon/);
    await expect(makeService('Out of Stock').calculatePricing({ lines: [line] })).rejects.toThrow(/"Matcha" is out of stock/);
    await expect(makeService('In Stock').calculatePricing({ lines: [line] })).resolves.toMatchObject({ subtotal: expect.any(Number) });
  });

  it('an order the card was already charged for is still recorded', async () => {
    await expect(makeService('Out of Stock').calculatePricing({ lines: [line] }, { allowUnavailable: true })).resolves.toBeTruthy();
  });
});
