import { describe, expect, it, vi } from 'vitest';
import { productIdsInOrderLine } from './review-rules.js';
import { ReviewsService } from './reviews.service.js';

describe('productIdsInOrderLine', () => {
  it('reads single products and bundles', () => {
    expect(productIdsInOrderLine('p1')).toEqual(['p1']);
    expect(productIdsInOrderLine('bundle-p1+p2+p3')).toEqual(['p1', 'p2', 'p3']);
  });
});

const input = { rating: 5, title: '', body: 'Lovely tea, really calming' };

function setup({ orders = [] as Array<{ orderNumber: string; updatedAt: Date; items: { productId: string }[] }>, existing = null as unknown } = {}) {
  const prisma = {
    product: {
      findFirst: vi.fn().mockResolvedValue({ id: 'p1' }),
      findMany: vi.fn().mockResolvedValue([{ id: 'p1', slug: 'tea', name: 'Tea', image: '' }]),
      update: vi.fn().mockResolvedValue({}),
    },
    order: { findMany: vi.fn().mockResolvedValue(orders) },
    user: { findUnique: vi.fn().mockResolvedValue({ firstName: 'Sarah', lastName: 'Mitchell', email: 'Sarah@Example.com' }) },
    productReview: {
      findUnique: vi.fn().mockResolvedValue(existing),
      findMany: vi.fn().mockResolvedValue(existing ? [existing] : []),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'r1', ...data })),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...(existing as object), ...data })),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  };
  return { service: new ReviewsService(prisma as never), prisma };
}

const delivered = (productId: string) => [{ orderNumber: 'SLZ-1', updatedAt: new Date('2026-11-01'), items: [{ productId }] }];

describe('writing reviews needs a delivered purchase', () => {
  it('refuses a product the customer has not received', async () => {
    const { service, prisma } = setup();
    await expect(service.writeMine('u1', 'tea', input)).rejects.toThrow(/delivered/);
    expect(prisma.productReview.create).not.toHaveBeenCalled();
  });

  it('only looks at paid, delivered, live orders', async () => {
    const { service, prisma } = setup();
    await service.mine('u1', 'tea');
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ paymentStatus: 'PAID', status: 'DELIVERED', archivedAt: null });
    // Same as "My orders": the account's orders, or orders placed with its email.
    expect(where.OR).toEqual([{ userId: 'u1' }, { customerEmail: 'sarah@example.com' }]);
  });

  it('allows a delivered product, including one bought in a bundle', async () => {
    for (const line of ['p1', 'bundle-p9+p1']) {
      const { service, prisma } = setup({ orders: delivered(line) });
      await service.writeMine('u1', 'tea', input);
      expect(prisma.productReview.create.mock.calls[0][0].data).toMatchObject({ productId: 'p1', verifiedPurchase: true });
    }
  });

  it('still lets the customer edit a review they already wrote', async () => {
    const { service, prisma } = setup({ existing: { id: 'r1', productId: 'p1', archivedAt: null, verifiedPurchase: false } });
    await service.writeMine('u1', 'tea', input);
    expect(prisma.productReview.update).toHaveBeenCalled();
  });

  it('reports canReview on the product page', async () => {
    expect((await setup().service.mine('u1', 'tea')).canReview).toBe(false);
    expect((await setup({ orders: delivered('p1') }).service.mine('u1', 'tea')).canReview).toBe(true);
  });

  it('lists delivered products waiting for a review in the account', async () => {
    const res = await setup({ orders: delivered('p1') }).service.myReviewList('u1');
    expect(res.toReview).toBe(1);
    expect(res.items[0]).toMatchObject({ product: { id: 'p1' }, review: null, canReview: true, purchase: { orderNumber: 'SLZ-1' } });
  });
});
