import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderStatus,
  PaymentStatus,
  RefundStatus,
  UserRole,
} from '../generated/prisma/enums.js';
import type { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CheckoutService } from './checkout.service.js';

describe('CheckoutService', () => {
  let service: CheckoutService;
  let mockPrisma: any;
  let mockConfig: any;
  let mockMail: { sendOrderConfirmationEmails: ReturnType<typeof vi.fn> };

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
      coupon: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      refundRequest: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    mockConfig = {
      get: vi.fn((key: string) => {
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_mock_123';
        if (key === 'STRIPE_PUBLISHABLE_KEY') return 'pk_test_mock_123';
        if (key === 'STRIPE_WEBHOOK_SECRET') return 'whsec_mock_123';
        return null;
      }),
    };

    mockMail = {
      sendOrderConfirmationEmails: vi.fn().mockResolvedValue(undefined),
    };

    service = new CheckoutService(
      mockPrisma as unknown as PrismaService,
      mockConfig as unknown as ConfigService,
      mockMail as unknown as MailService,
    );
  });

  it('calculates pricing correctly with catalog items and shipping', async () => {
    const pricing = await service.calculatePricing({
      lines: [{ productId: 'p01', sizeIndex: 0, months: 1, qty: 1 }],
      shippingMethodId: 'uk-express',
    });

    // p01 price: 27.99, shipping: 4.99
    expect(pricing.subtotal).toBe(27.99);
    expect(pricing.shipping).toBe(4.99);
    expect(pricing.total).toBe(32.98);
    expect(pricing.totalInPence).toBe(3298);
  });

  it('applies valid active DB coupon discount', async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue({
      id: 'cpn-1',
      code: 'SLIMZAX2',
      discountPercent: 10,
      customerRange: 100,
      uses: 5,
      generateDate: '2026-01-01',
      expiredDate: '2099-12-31',
      isActive: true,
    });

    const pricing = await service.calculatePricing({
      lines: [{ productId: 'p02', sizeIndex: 0, months: 1, qty: 1 }],
      promoCode: 'SLIMZAX2',
      shippingMethodId: 'uk-standard',
    });

    // p02 base: 39.99, discount: 4.00, shipping: 0
    expect(pricing.subtotal).toBe(39.99);
    expect(pricing.discount).toBe(4.0);
    expect(pricing.total).toBe(35.99);
    expect(pricing.totalInPence).toBe(3599);
    expect(pricing.promoCode).toBe('SLIMZAX2');
  });

  it('rejects expired coupon in strict checkout mode and gives zero discount otherwise', async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue({
      id: 'cpn-expired',
      code: 'EXPIRED10',
      discountPercent: 10,
      customerRange: 100,
      uses: 0,
      generateDate: '2020-01-01',
      expiredDate: '2020-01-31',
      isActive: true,
    });

    await expect(
      service.calculatePricing(
        {
          lines: [{ productId: 'p02', sizeIndex: 0, months: 1, qty: 1 }],
          promoCode: 'EXPIRED10',
          shippingMethodId: 'uk-standard',
        },
        { strictPromo: true },
      ),
    ).rejects.toThrow(/expired/i);

    const pricing = await service.calculatePricing({
      lines: [{ productId: 'p02', sizeIndex: 0, months: 1, qty: 1 }],
      promoCode: 'EXPIRED10',
      shippingMethodId: 'uk-standard',
    });
    expect(pricing.discount).toBe(0);
    expect(pricing.promoCode).toBeNull();
  });

  it('confirms and records order in database', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(null);
    mockPrisma.order.create.mockResolvedValue({
      id: 'order-123',
      orderNumber: 'SLZ-99999',
      customerName: 'Jane Doe',
      customerEmail: 'jane@example.com',
      customerPhone: '07123456789',
      shippingAddress: {
        name: 'Jane Doe',
        line1: '10 Downing Street',
        city: 'London',
        postcode: 'SW1A 2AA',
        country: 'United Kingdom',
      },
      shippingMethod: 'uk-standard',
      shippingFee: 0,
      subtotal: 39.99,
      discount: 0,
      bundleReward: 0,
      promoCode: null,
      total: 39.99,
      status: OrderStatus.PROCESSING,
      paymentStatus: PaymentStatus.PAID,
      items: [
        {
          productName: 'Himalayan Shilajit Resin',
          quantity: 1,
          unitPrice: 39.99,
          totalPrice: 39.99,
          sizeLabel: '15g',
          planLabel: '1 Month',
        },
      ],
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
    expect(mockMail.sendOrderConfirmationEmails).toHaveBeenCalledTimes(1);
    expect(mockMail.sendOrderConfirmationEmails).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: 'SLZ-99999',
        customerEmail: 'jane@example.com',
      }),
    );
  });

  it('blocks admin accounts from purchasing products', async () => {
    const sampleAddress = {
      name: 'Slimza Admin',
      email: 'admin@slimza.com',
      phone: '07123456789',
      line1: '10 Downing Street',
      city: 'London',
      postcode: 'SW1A 2AA',
      country: 'United Kingdom',
      deliveryNotes: '',
    };

    await expect(
      service.confirmOrder(
        {
          paymentMode: 'demo',
          shippingMethodId: 'uk-standard',
          shippingAddress: sampleAddress,
          lines: [{ productId: 'p02', sizeIndex: 0, months: 1, qty: 1 }],
        },
        'admin-id',
        UserRole.ADMIN,
      ),
    ).rejects.toThrow(ForbiddenException);

    mockPrisma.user.findUnique.mockResolvedValue({ role: UserRole.ADMIN });

    await expect(
      service.createPaymentIntent({
        shippingMethodId: 'uk-standard',
        shippingAddress: sampleAddress,
        lines: [{ productId: 'p02', sizeIndex: 0, months: 1, qty: 1 }],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('blocks suspended accounts from paying, signed in or as a guest with the same email', async () => {
    const input = {
      shippingMethodId: 'uk-standard',
      shippingAddress: {
        name: 'Sam Blocked',
        email: 'sam@example.com',
        phone: '07123456789',
        line1: '1 High Street',
        line2: '',
        city: 'London',
        postcode: 'E1 6AN',
        country: 'United Kingdom',
        deliveryNotes: '',
      },
      lines: [{ productId: 'p02', sizeIndex: 0, months: 1, qty: 1 }],
      bundles: [],
    };
    mockPrisma.user.findUnique.mockResolvedValue({
      role: UserRole.CUSTOMER,
      status: 'SUSPENDED',
      archivedAt: null,
      suspensionReason: 'Chargeback',
    });

    // signed in
    await expect(service.createPaymentIntent(input, 'user-sam', UserRole.CUSTOMER)).rejects.toMatchObject({
      response: { code: 'ACCOUNT_SUSPENDED' },
    });
    // guest checkout using the suspended account's email
    await expect(service.createPaymentIntent(input)).rejects.toMatchObject({
      response: { code: 'ACCOUNT_SUSPENDED' },
    });
    await expect(
      service.confirmOrder({ ...input, paymentMode: 'demo', paymentLabel: 'Paid securely' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows customer refund request for non-delivered order and blocks delivered order', async () => {
    const customer = {
      sub: 'user-1',
      email: 'jane@example.com',
      role: UserRole.CUSTOMER,
    };

    mockPrisma.order.findFirst.mockResolvedValueOnce({
      id: 'ord-delivered',
      orderNumber: 'SLZ-11111',
      userId: 'user-1',
      customerEmail: 'jane@example.com',
      customerName: 'Jane Doe',
      total: 29.99,
      currency: 'gbp',
      status: OrderStatus.DELIVERED,
      paymentStatus: PaymentStatus.PAID,
      items: [],
      refundRequest: null,
    });

    await expect(
      service.requestRefund('ord-delivered', customer, 'Want to cancel'),
    ).rejects.toThrow(BadRequestException);

    mockPrisma.order.findFirst.mockResolvedValueOnce({
      id: 'ord-processing',
      orderNumber: 'SLZ-22222',
      userId: 'user-1',
      customerEmail: 'jane@example.com',
      customerName: 'Jane Doe',
      total: 29.99,
      currency: 'gbp',
      status: OrderStatus.PROCESSING,
      paymentStatus: PaymentStatus.PAID,
      items: [],
      refundRequest: null,
    });

    mockPrisma.refundRequest.create.mockResolvedValue({
      id: 'ref-1',
      orderId: 'ord-processing',
      status: RefundStatus.REQUESTED,
      reason: 'Ordered wrong item by mistake',
      amount: 29.99,
    });

    const created = await service.requestRefund(
      'ord-processing',
      customer,
      'Ordered wrong item by mistake',
    );
    expect(created.id).toBe('ref-1');
    expect(created.status).toBe(RefundStatus.REQUESTED);
  });
});
