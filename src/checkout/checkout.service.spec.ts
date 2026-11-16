import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, PaymentStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CheckoutService } from './checkout.service.js';

describe('CheckoutService', () => {
  let service: CheckoutService;
  let mockPrisma: any;
  let mockConfig: any;

  beforeEach(() => {
    mockPrisma = {
      order: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
    };

    mockConfig = {
      get: vi.fn((key: string) => {
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_mock_123';
        if (key === 'STRIPE_PUBLISHABLE_KEY') return 'pk_test_mock_123';
        if (key === 'STRIPE_WEBHOOK_SECRET') return 'whsec_mock_123';
        return null;
      }),
    };

    service = new CheckoutService(
      mockPrisma as unknown as PrismaService,
      mockConfig as unknown as ConfigService,
    );
  });

  it('calculates pricing correctly with catalog items and shipping', () => {
    const pricing = service.calculatePricing({
      lines: [{ productId: 'p01', sizeIndex: 0, months: 1, qty: 1 }],
      shippingMethodId: 'uk-express',
    });

    // p01 price: 27.99, shipping: 4.99
    expect(pricing.subtotal).toBe(27.99);
    expect(pricing.shipping).toBe(4.99);
    expect(pricing.total).toBe(32.98);
    expect(pricing.totalInPence).toBe(3298);
  });

  it('applies promo code SLIMZAX2 discount', () => {
    const pricing = service.calculatePricing({
      lines: [{ productId: 'p02', sizeIndex: 0, months: 1, qty: 1 }],
      promoCode: 'SLIMZAX2',
      shippingMethodId: 'uk-standard',
    });

    // p02 base: 39.99, discount: 4.00, shipping: 0
    expect(pricing.subtotal).toBe(39.99);
    expect(pricing.discount).toBe(4.0);
    expect(pricing.total).toBe(35.99);
    expect(pricing.totalInPence).toBe(3599);
  });

  it('confirms and records order in database', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(null);
    mockPrisma.order.create.mockResolvedValue({
      id: 'order-123',
      orderNumber: 'SLZ-99999',
      total: 39.99,
      status: OrderStatus.PROCESSING,
      paymentStatus: PaymentStatus.PAID,
      items: [],
    });

    const result = await service.confirmOrder({
      paymentIntentId: 'pi_test_123',
      paymentMode: 'stripe',
      shippingMethodId: 'uk-standard',
      shippingAddress: {
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '07123456789',
        line1: '10 Downing Street',
        city: 'London',
        postcode: 'SW1A 2AA',
        country: 'United Kingdom',
        deliveryNotes: '',
      },
      lines: [{ productId: 'p02', sizeIndex: 0, months: 1, qty: 1 }],
    });

    expect(result.id).toBe('order-123');
    expect(mockPrisma.order.create).toHaveBeenCalled();
  });
});
