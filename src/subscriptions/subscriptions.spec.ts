import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutService } from '../checkout/checkout.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { addInterval, intervalText, optionUnitPrice, readSupplyOptions, supplyOptionsSchema } from '../products/supply-options.js';
import { commitmentText, readSubscriptionSettings } from './subscription-settings.js';
import { SubscriptionsService } from './subscriptions.service.js';

const fourMonths = { id: 'o120', label: '120 – 4 Month Supply', interval: 'month' as const, intervalCount: 4, price: 24.99, compareAtPrice: 29.99, servings: 120, badge: 'Most popular', subscribeDiscountPercent: 20 };

describe('supply options', () => {
  it('prices one-time and Subscribe & Save', () => {
    expect(optionUnitPrice(fourMonths, 'once')).toBe(24.99);
    expect(optionUnitPrice(fourMonths, 'subscription')).toBe(19.99);
    expect(intervalText(fourMonths)).toBe('every 4 months');
    expect(intervalText({ interval: 'week', intervalCount: 2 })).toBe('every 2 weeks');
    expect(intervalText({ interval: 'month', intervalCount: 1 })).toBe('every month');
    expect(addInterval(new Date('2026-01-15'), fourMonths).toISOString().slice(0, 10)).toBe('2026-05-15');
  });

  it('validates and reads options', () => {
    expect(supplyOptionsSchema.safeParse([fourMonths, fourMonths]).success).toBe(false); // duplicate id
    expect(supplyOptionsSchema.safeParse([{ ...fourMonths, price: 0 }]).success).toBe(false);
    expect(readSupplyOptions([fourMonths, { junk: true }])).toHaveLength(1);
  });

  it('settings and commitment text', () => {
    expect(readSubscriptionSettings(undefined)).toEqual({ enabled: true, minOrders: 2 });
    expect(commitmentText(2)).toBe('Minimum 2 deliveries, then cancel any time.');
    expect(commitmentText(1)).toBe('Cancel any time.');
  });
});

function checkout(product: Record<string, unknown>) {
  const prisma = {
    cmsSection: { findUnique: vi.fn().mockResolvedValue(null) },
    product: {
      findFirst: vi.fn().mockResolvedValue({ id: 'db-1', name: 'CoQ10', price: 24.99, image: '', stockStatus: 'In Stock', archivedAt: null, supplyOptions: [fourMonths], subscriptionEnabled: true, ...product }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    coupon: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  return new CheckoutService(prisma as unknown as PrismaService, { get: vi.fn(() => null) } as unknown as ConfigService);
}
const line = (purchase: 'once' | 'subscription') => ({ productId: 'db-1', optionId: 'o120', purchase, qty: 2 });

describe('checkout with supply options', () => {
  it('one-time purchase uses the option price', async () => {
    const pricing = await checkout({}).calculatePricing({ lines: [line('once')] });
    expect(pricing.subtotal).toBe(49.98);
    expect(pricing.subscriptionLines).toHaveLength(0);
    expect(pricing.lineItems[0]).toMatchObject({ sizeLabel: '120 – 4 Month Supply', planLabel: 'One-time purchase' });
  });

  it('Subscribe & Save uses the discounted price; tax stays on the full price', async () => {
    const pricing = await checkout({ taxIncluded: false, taxType: 'percent', taxValue: 10 }).calculatePricing(
      { lines: [line('subscription')], shippingMethodId: 'uk-express' },
      { subscriptionsEnabled: true },
    );
    expect(pricing.subtotal).toBe(39.98);
    expect(pricing.tax).toBe(5); // 10% of 2 × £24.99, not of the subscription price
    expect(pricing.subscriptionLines[0]).toMatchObject({ quantity: 2, unitPrice: 19.99, tax: 5 });
    expect(pricing.lineItems[0].planLabel).toBe('Subscribe & Save · every 4 months');
  });

  it('refuses subscriptions when they are off, or the product has none', async () => {
    await expect(checkout({}).calculatePricing({ lines: [line('subscription')] })).rejects.toThrow(/not available right now/);
    await expect(checkout({ subscriptionEnabled: false }).calculatePricing({ lines: [line('subscription')] }, { subscriptionsEnabled: true })).rejects.toThrow(/isn't available on Subscribe & Save/);
    await expect(checkout({}).calculatePricing({ lines: [{ ...line('once'), optionId: 'gone' }] })).rejects.toThrow(/no longer available/);
  });
});

function subscriptionsService(sub: Record<string, unknown> | null, existingOrder: unknown = null) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    cmsSection: { findUnique: vi.fn().mockResolvedValue(null) },
    subscription: {
      findUnique: vi.fn().mockResolvedValue(sub),
      findFirst: vi.fn().mockResolvedValue(sub),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...sub, ...data, user: { email: 'sam@example.com', name: 'Sam' } })),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 's-new', ...data })),
    },
    order: {
      findUnique: vi.fn().mockImplementation(({ where }) => Promise.resolve(where.stripeInvoiceId ? existingOrder : null)),
      create: vi.fn().mockImplementation(({ data }) => {
        created.push(data);
        return Promise.resolve({ id: 'o-new', ...data, status: 'PLACED', items: [] });
      }),
    },
  };
  return { service: new SubscriptionsService(prisma as unknown as PrismaService, { get: () => '' } as unknown as ConfigService), prisma, created };
}
const baseSub = {
  id: 's1', userId: 'u1', productId: 'db-1', status: 'ACTIVE', stripeSubscriptionId: 'sub_1', productName: 'CoQ10', productImage: '', optionId: 'o120',
  optionLabel: '120 – 4 Month Supply', interval: 'month', intervalCount: 4, quantity: 1, unitPrice: 19.99, shippingMethod: 'uk-standard', shippingFee: 3.99,
  tax: 0, renewalAmount: 23.98, shippingAddress: { name: 'Sam', email: 'sam@example.com' }, paymentLabel: 'Visa •••• 4242', ordersCount: 1, minOrders: 2,
  user: { email: 'sam@example.com', name: 'Sam' },
};
const invoice = { id: 'in_1', billing_reason: 'subscription_cycle', amount_paid: 2398, parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [{ period: { end: 1800000000 } }] } };

describe('SubscriptionsService', () => {
  it('a paid renewal creates the next order (once per invoice)', async () => {
    const { service, prisma, created } = subscriptionsService(baseSub);
    const order = await service.recordRenewal(invoice as never);
    expect(order).toMatchObject({ subscriptionId: 's1', subscriptionSequence: 2, total: 23.98, stripeInvoiceId: 'in_1', paymentStatus: 'PAID' });
    expect(created[0]).toMatchObject({ shippingFee: 3.99, subtotal: 19.99 });
    expect(prisma.subscription.update.mock.calls[0][0].data).toMatchObject({ ordersCount: 2, status: 'ACTIVE' });

    const again = subscriptionsService(baseSub, { id: 'o-existing' });
    expect(await again.service.recordRenewal(invoice as never)).toEqual({ id: 'o-existing' });
    expect(again.prisma.order.create).not.toHaveBeenCalled();
  });

  it('ignores the £0 invoice when the subscription starts', async () => {
    const { service, prisma } = subscriptionsService(baseSub);
    expect(await service.recordRenewal({ ...invoice, billing_reason: 'subscription_create', amount_paid: 0 } as never)).toBeNull();
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('customers can only cancel after the minimum deliveries', async () => {
    await expect(subscriptionsService(baseSub).service.cancelMine('u1', 's1')).rejects.toThrow(/minimum of 2 deliveries\. You can cancel after 1 more delivery/);
    const res = await subscriptionsService({ ...baseSub, ordersCount: 2 }).service.cancelMine('u1', 's1');
    expect(res).toMatchObject({ status: 'CANCELLED' });
  });

  it('without Stripe a new subscription is recorded as not started (the first order is still paid)', async () => {
    const { service, prisma } = subscriptionsService(null);
    const [row] = await service.startFromOrder({
      userId: 'u1',
      order: { id: 'o1', orderNumber: 'SLZ-1', customerEmail: 'sam@example.com', customerName: 'Sam' },
      lines: [{ productId: 'db-1', productName: 'CoQ10', productImage: '', option: fourMonths, quantity: 1, unitPrice: 19.99, tax: 0 }],
      shippingMethod: 'uk-standard',
      shippingFee: 3.99,
      shippingAddress: {},
      paymentLabel: 'Visa •••• 4242',
      stripeCustomerId: null,
      paymentMethodId: null,
    });
    expect(row).toMatchObject({ status: 'CANCELLED' });
    // Renewal = subscription price × qty + delivery + tax
    expect(prisma.subscription.create.mock.calls[0][0].data).toMatchObject({ renewalAmount: 23.98, ordersCount: 1, minOrders: 2 });
  });
});

describe('products are priced by their purchase options', () => {
  it('shop price = cheapest option, with its "was" price', async () => {
    const { priceFromOptions } = await import('../products/supply-options.js');
    const two = { ...fourMonths, id: 'o60', label: '60 – 2 Month Supply', intervalCount: 2, price: 12.74, compareAtPrice: 16.99 };
    expect(priceFromOptions([fourMonths, two])).toEqual({ price: 12.74, originalPrice: 16.99, discountPercent: 25 });
    expect(priceFromOptions([])).toBeNull();
  });

  it('a basket line without an option uses the first option', async () => {
    const pricing = await checkout({}).calculatePricing({ lines: [{ productId: 'db-1', qty: 1 }] });
    expect(pricing.lineItems[0]).toMatchObject({ sizeLabel: '120 – 4 Month Supply', unitPrice: 24.99, planLabel: 'One-time purchase' });
  });
});
