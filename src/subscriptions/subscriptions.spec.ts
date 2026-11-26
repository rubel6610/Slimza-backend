import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutService } from '../checkout/checkout.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { addInterval, intervalText, optionUnitPrice, readSupplyOptions, supplyOptionsSchema } from '../products/supply-options.js';
import { commitmentText, parseSubscriptionSettingsForSave, pickFrequency, readSubscriptionSettings } from './subscription-settings.js';
import { SubscriptionsService } from './subscriptions.service.js';

const fourMonths = { id: 'o120', label: '120 – 4 Month Supply', interval: 'month' as const, intervalCount: 4, price: 24.99, compareAtPrice: 29.99, servings: 120, badge: 'Most popular', subscribeDiscountPercent: 20 };

describe('supply options', () => {
  it('prices one-time and Subscribe & Save', () => {
    expect(optionUnitPrice(fourMonths, 'once')).toBe(24.99);
    expect(optionUnitPrice(fourMonths, 'subscription', 20)).toBe(19.99); // store-wide "Save 20%"
    expect(optionUnitPrice(fourMonths, 'subscription', 0)).toBe(24.99);
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
    expect(readSubscriptionSettings(undefined)).toMatchObject({ enabled: true, minOrders: 1, discountPercent: 15, discountOnFirstOrder: false, defaultFrequencyId: 'month-1' });
    // Settings saved before the store-wide discount keep their values and get the new defaults.
    const old = readSubscriptionSettings({ enabled: false, minOrders: 3 });
    expect(old).toMatchObject({ enabled: false, minOrders: 3, discountPercent: 15 });
    // Monthly on; weekly / 2 weeks / 6 months / yearly available but off.
    expect(old.frequencies.filter((f) => f.active).map((f) => f.label)).toEqual(['Every month']);
    expect(old.frequencies.map((f) => f.id)).toEqual(['month-1', 'week-1', 'week-2', 'month-6', 'month-12']);
    expect(pickFrequency(old, 'week-1').id).toBe('month-1'); // switched off → the default
    const withWeekly = { ...old, frequencies: old.frequencies.map((f) => ({ ...f, active: true })) };
    expect(pickFrequency(withWeekly, 'week-1')).toMatchObject({ interval: 'week', intervalCount: 1 });
    expect(parseSubscriptionSettingsForSave({ ...old, frequencies: old.frequencies.map((f) => ({ ...f, active: false })) })).toMatchObject({ ok: false });
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

  it('Subscribe & Save: first order at the normal price, 15% off every renewal; tax on the full price', async () => {
    const pricing = await checkout({ taxIncluded: false, taxType: 'percent', taxValue: 10 }).calculatePricing(
      { lines: [line('subscription')], shippingMethodId: 'uk-express' },
      { subscriptionsEnabled: true },
    );
    expect(pricing.subtotal).toBe(49.98); // 2 × £24.99 today
    expect(pricing.tax).toBe(5); // 10% of 2 × £24.99
    expect(pricing.subscriptionLines[0]).toMatchObject({ quantity: 2, unitPrice: 24.99, renewalUnitPrice: 21.24, tax: 5 });
    // The customer's frequency, not the package length (default: every month).
    expect(pricing.subscriptionLines[0].frequency).toMatchObject({ id: 'month-1', interval: 'month', intervalCount: 1 });
    expect(pricing.lineItems[0].planLabel).toBe('Subscribe & Save · Every month');
  });

  it('"discount on the first order" on: the first order gets the 15% too', async () => {
    const service = checkout({});
    const prisma = (service as unknown as { prisma: { cmsSection: { findUnique: ReturnType<typeof vi.fn> } } }).prisma;
    prisma.cmsSection.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where.key === 'subscriptions' ? { data: { enabled: true, minOrders: 1, discountOnFirstOrder: true } } : null),
    );
    const pricing = await service.calculatePricing({ lines: [line('subscription')] }, { subscriptionsEnabled: true });
    expect(pricing.subscriptionLines[0]).toMatchObject({ unitPrice: 21.24, renewalUnitPrice: 21.24 });
  });

  it("client's example: £49.98 with the 50% code = £24.99 (one-time and the first subscription order), renewals £21.24", async () => {
    const pack = { ...fourMonths, price: 49.98, compareAtPrice: null };
    const withCoupon = (purchase: 'once' | 'subscription') => {
      const service = checkout({ supplyOptions: [pack] });
      const prisma = (service as unknown as { prisma: { coupon: { findUnique: ReturnType<typeof vi.fn> } } }).prisma;
      prisma.coupon.findUnique.mockResolvedValue({ code: 'SLIMZA50', discountPercent: 50, isActive: true, generateDate: '2000-01-01', expiredDate: '2999-12-31', customerRange: 0, uses: 0, archivedAt: null });
      return service.calculatePricing({ lines: [{ ...line(purchase), qty: 1 }], promoCode: 'SLIMZA50' }, { subscriptionsEnabled: true });
    };
    const once = await withCoupon('once');
    expect([once.subtotal, once.discount, once.total]).toEqual([49.98, 24.99, 24.99]); // 50% of £49.98, not of £24.99
    const sub = await withCoupon('subscription');
    expect([sub.subtotal, sub.discount, sub.total]).toEqual([49.98, 24.99, 24.99]);
    expect(sub.subscriptionLines[0].renewalUnitPrice).toBe(21.24); // £49.98 × 85% × 50%
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

  it('customers can pause and resume; a paused plan skips missed renewal dates', async () => {
    const paused = await subscriptionsService({ ...baseSub, stripeSubscriptionId: null }).service.pauseMine('u1', 's1');
    expect(paused).toMatchObject({ status: 'PAUSED', canResume: true, canPause: false });
    const past = new Date(Date.now() - 40 * 86_400_000);
    const { service, prisma } = subscriptionsService({ ...baseSub, stripeSubscriptionId: null, status: 'PAUSED', interval: 'month', intervalCount: 1, nextRenewalAt: past });
    const resumed = await service.resumeMine('u1', 's1');
    expect(resumed.status).toBe('ACTIVE');
    expect(prisma.subscription.update.mock.calls[0][0].data.nextRenewalAt.getTime()).toBeGreaterThan(Date.now());
    await expect(subscriptionsService({ ...baseSub, status: 'CANCELLED' }).service.pauseMine('u1', 's1')).rejects.toThrow(/cancelled/);
  });

  it('without Stripe a new subscription is recorded as not started (the first order is still paid)', async () => {
    const { service, prisma } = subscriptionsService(null);
    const [row] = await service.startFromOrder({
      userId: 'u1',
      order: { id: 'o1', orderNumber: 'SLZ-1', customerEmail: 'sam@example.com', customerName: 'Sam' },
      lines: [
        {
          productId: 'db-1', productName: 'CoQ10', productImage: '', option: fourMonths, quantity: 1, unitPrice: 19.99, renewalUnitPrice: 19.99, tax: 0,
          frequency: { id: 'month-1', label: 'Every month', interval: 'month', intervalCount: 1 },
        },
      ],
      shippingMethod: 'uk-standard',
      shippingFee: 3.99,
      shippingAddress: {},
      paymentLabel: 'Visa •••• 4242',
      stripeCustomerId: null,
      paymentMethodId: null,
    });
    expect(row).toMatchObject({ status: 'CANCELLED' });
    // Renewal = subscription price × qty + delivery + tax
    expect(prisma.subscription.create.mock.calls[0][0].data).toMatchObject({ renewalAmount: 23.98, ordersCount: 1, minOrders: 1, interval: 'month', intervalCount: 1 });
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
