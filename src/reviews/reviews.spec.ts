import { describe, expect, it, vi } from 'vitest';
import { publicName, summarise } from './review-rules.js';
import { adminUpdateReviewSchema, writeReviewSchema } from './reviews.schemas.js';
import { ReviewsService } from './reviews.service.js';

describe('review rules', () => {
  it('builds a public name from first name + last initial', () => {
    expect(publicName({ firstName: 'Sarah', lastName: 'mitchell' })).toBe('Sarah M.');
    expect(publicName({ name: 'James Taylor' })).toBe('James T.');
    expect(publicName({ name: 'Cher' })).toBe('Cher');
    expect(publicName({})).toBe('Slimza customer');
  });

  it('summarises ratings', () => {
    expect(summarise([{ rating: 5, count: 3 }, { rating: 4, count: 1 }, { rating: 1, count: 1 }])).toEqual({
      average: 4,
      count: 5,
      breakdown: { 1: 1, 2: 0, 3: 0, 4: 1, 5: 3 },
    });
    expect(summarise([]).average).toBe(0);
  });

  it('validates customer and admin input', () => {
    expect(writeReviewSchema.safeParse({ rating: 6, body: 'Lovely tea, really calming' }).success).toBe(false);
    expect(writeReviewSchema.safeParse({ rating: 5, body: 'short' }).success).toBe(false);
    expect(writeReviewSchema.parse({ rating: '4', body: 'Lovely tea, really calming' })).toMatchObject({ rating: 4, title: '' });
    expect(adminUpdateReviewSchema.safeParse({}).success).toBe(false);
  });
});

const review = {
  id: 'r1',
  productId: 'p1',
  userId: 'u1',
  authorName: 'Sarah M.',
  rating: 5,
  title: '',
  body: 'Great tea, would buy again',
  status: 'PUBLISHED',
  featured: false,
  featuredAt: null,
  archivedAt: null,
};

function makeService(existing: Record<string, unknown> = review) {
  const prisma = {
    productReview: {
      findUnique: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data })),
      groupBy: vi.fn().mockResolvedValue([{ rating: 4, _count: { _all: 2 } }]),
    },
    product: { update: vi.fn().mockResolvedValue({}) },
  };
  return { service: new ReviewsService(prisma as never), prisma };
}

describe('ReviewsService.adminUpdate', () => {
  it('features a published review and keeps the product rating in sync', async () => {
    const { service, prisma } = makeService();
    const res = await service.adminUpdate('r1', { featured: true });
    expect(res.featured).toBe(true);
    expect(res.featuredAt).toBeInstanceOf(Date);
    expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { rating: 4, reviewCount: 2 } });
  });

  it('hiding a review takes it off the homepage', async () => {
    const { service } = makeService({ ...review, featured: true, featuredAt: new Date() });
    const res = await service.adminUpdate('r1', { status: 'HIDDEN' });
    expect(res).toMatchObject({ status: 'HIDDEN', featured: false, featuredAt: null });
  });

  it('refuses to feature a hidden review', async () => {
    const { service } = makeService({ ...review, status: 'HIDDEN' });
    await expect(service.adminUpdate('r1', { featured: true })).rejects.toThrow(/Show the review/);
  });

  it('marks wording changes as edited by Slimza and stores replies', async () => {
    const { service } = makeService();
    const res = await service.adminUpdate('r1', { body: 'Great tea!', adminReply: 'Thank you Sarah!' });
    expect(res).toMatchObject({ body: 'Great tea!', editedByAdmin: true, adminReply: 'Thank you Sarah!' });
    const cleared = await service.adminUpdate('r1', { adminReply: '' });
    expect(cleared).toMatchObject({ adminReply: null, adminReplyAt: null });
  });

  it('only deletes archived reviews', async () => {
    const { service } = makeService();
    await expect(service.remove('r1')).rejects.toThrow(/not archived/);
  });
});
