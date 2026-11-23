import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { archiveWhere, assertArchivedBeforeDelete } from '../common/archive/archive.js';
import { paginate, searchWhere, toOrderBy } from '../common/pagination/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PUBLIC_PRODUCT_WHERE } from '../products/product-search.js';
import { productIdsInOrderLine, publicName, REVIEWABLE_ORDER, summarise, type RatingSummary } from './review-rules.js';
import type {
  AdminReviewsQuery,
  AdminUpdateReviewInput,
  ProductReviewsQuery,
  WriteReviewInput,
} from './reviews.schemas.js';

/** What the storefront may see of a review (never the customer's id or email). */
const PUBLIC_SELECT = {
  id: true,
  authorName: true,
  rating: true,
  title: true,
  body: true,
  verifiedPurchase: true,
  adminReply: true,
  adminReplyAt: true,
  createdAt: true,
  user: { select: { avatarUrl: true } },
} satisfies Prisma.ProductReviewSelect;

type PublicRow = Prisma.ProductReviewGetPayload<{ select: typeof PUBLIC_SELECT }>;

const toPublic = ({ user, ...r }: PublicRow) => ({ ...r, avatarUrl: user?.avatarUrl ?? '' });

/** Reviews that count: shown on the product page and in the product's rating. */
const VISIBLE: Prisma.ProductReviewWhereInput = { status: 'PUBLISHED', archivedAt: null };

const SORTS: Record<ProductReviewsQuery['sort'], Prisma.ProductReviewOrderByWithRelationInput[]> = {
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
  highest: [{ rating: 'desc' }, { createdAt: 'desc' }],
  lowest: [{ rating: 'asc' }, { createdAt: 'desc' }],
};

/**
 * Product reviews.
 *  - Customers: one review per product, only for products from a paid, delivered order
 *    (editing replaces it). Live straight away. Account → My reviews lists what they can review.
 *  - Admins: hide/show, edit, reply, feature on the homepage, archive → delete.
 * Product.rating / reviewCount are recalculated after every change (`syncProductRating`).
 */
@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Public ----------------------------------------------------------------------

  /** Product page: summary + one page of visible reviews. */
  async listForProduct(ref: string, query: ProductReviewsQuery) {
    const product = await this.findPublicProduct(ref);
    const where: Prisma.ProductReviewWhereInput = { ...VISIBLE, productId: product.id, ...(query.rating ? { rating: query.rating } : {}) };
    const [summary, page] = await Promise.all([
      this.summaryFor(product.id),
      paginate(query, {
        count: () => this.prisma.productReview.count({ where }),
        findMany: ({ skip, take }) =>
          this.prisma.productReview.findMany({ where, orderBy: SORTS[query.sort], skip, take, select: PUBLIC_SELECT }),
      }),
    ]);
    return { ...page, items: page.items.map(toPublic), summary, productId: product.id };
  }

  /** Homepage "What Our Customers Say". */
  async featured(limit: number) {
    const rows = await this.prisma.productReview.findMany({
      where: { ...VISIBLE, featured: true, product: PUBLIC_PRODUCT_WHERE },
      orderBy: [{ featuredAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: { ...PUBLIC_SELECT, product: { select: { name: true, slug: true } } },
    });
    return rows.map(({ product, ...r }) => ({ ...toPublic(r), product }));
  }

  // ---- Customer --------------------------------------------------------------------

  /** The signed-in customer's review of this product (null if none). */
  async mine(userId: string, ref: string) {
    const product = await this.findPublicProduct(ref);
    const review = await this.prisma.productReview.findUnique({ where: { productId_userId: { productId: product.id, userId } } });
    const bought = review ? review.verifiedPurchase : await this.hasBought(userId, product.id);
    return {
      review,
      verifiedPurchase: bought,
      /** New reviews need a delivered purchase; an existing review can still be edited. */
      canReview: review ? !review.archivedAt : bought,
    };
  }

  /**
   * Account → My reviews: every product from the customer's delivered orders (newest first),
   * with their review if they wrote one, plus any other reviews they have written.
   */
  async myReviewList(userId: string) {
    const [purchases, reviews] = await Promise.all([
      this.deliveredPurchases(userId),
      this.prisma.productReview.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    ]);
    const reviewByProduct = new Map(reviews.map((r) => [r.productId, r]));
    const ids = [...new Set([...purchases.keys(), ...reviewByProduct.keys()])];
    const products = await this.prisma.product.findMany({
      where: { ...PUBLIC_PRODUCT_WHERE, id: { in: ids } },
      select: { id: true, slug: true, name: true, image: true },
    });

    const items = products.map((product) => {
      const purchase = purchases.get(product.id) ?? null;
      const review = reviewByProduct.get(product.id) ?? null;
      return { product, purchase, review, canReview: review ? !review.archivedAt : Boolean(purchase) };
    });
    // Waiting for a review first, then most recently delivered.
    const time = (i: (typeof items)[number]) => new Date(i.purchase?.deliveredAt ?? i.review?.createdAt ?? 0).getTime();
    items.sort((a, b) => Number(Boolean(a.review)) - Number(Boolean(b.review)) || time(b) - time(a));
    return { items, toReview: items.filter((i) => !i.review && i.canReview).length };
  }

  /** Create or edit the customer's own review. */
  async writeMine(userId: string, ref: string, input: WriteReviewInput) {
    const product = await this.findPublicProduct(ref);
    const existing = await this.prisma.productReview.findUnique({ where: { productId_userId: { productId: product.id, userId } } });
    if (existing?.archivedAt) throw new ForbiddenException('This review was removed by Slimza and can no longer be edited.');

    const content = { rating: input.rating, title: input.title, body: input.body };
    let review;
    if (existing) {
      // The customer's own words replace any admin edit; a hidden review stays hidden.
      review = await this.prisma.productReview.update({ where: { id: existing.id }, data: { ...content, editedByAdmin: false } });
    } else {
      if (!(await this.hasBought(userId, product.id))) {
        throw new ForbiddenException('You can review a product once an order with it has been delivered to you.');
      }
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, name: true } });
      if (!user) throw new NotFoundException('Account not found');
      review = await this.prisma.productReview
        .create({
          data: {
            ...content,
            productId: product.id,
            userId,
            authorName: publicName(user),
            verifiedPurchase: true,
          },
        })
        .catch((err: { code?: string }) => {
          if (err?.code === 'P2002') throw new ConflictException('You have already reviewed this product.');
          throw err;
        });
    }
    await this.syncProductRating(product.id);
    return review;
  }

  async deleteMine(userId: string, ref: string) {
    const product = await this.findPublicProduct(ref);
    const existing = await this.prisma.productReview.findUnique({ where: { productId_userId: { productId: product.id, userId } } });
    if (!existing) throw new NotFoundException('You have not reviewed this product.');
    if (existing.archivedAt) throw new ForbiddenException('This review was removed by Slimza.');
    await this.prisma.productReview.delete({ where: { id: existing.id } });
    await this.syncProductRating(product.id);
    return { ok: true as const };
  }

  // ---- Admin -----------------------------------------------------------------------

  async adminList(query: AdminReviewsQuery) {
    const where: Prisma.ProductReviewWhereInput = {
      ...archiveWhere(query.archived),
      ...searchWhere(query.q, ['authorName', 'title', 'body'] as const),
      ...(query.status ? { status: query.status } : {}),
      ...(query.rating ? { rating: query.rating } : {}),
      ...(query.featured !== undefined ? { featured: query.featured } : {}),
      ...(query.verified !== undefined ? { verifiedPurchase: query.verified } : {}),
      ...(query.replied === true ? { adminReply: { not: null } } : query.replied === false ? { adminReply: null } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
    };
    return paginate(query, {
      count: () => this.prisma.productReview.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.productReview.findMany({
          where,
          orderBy: toOrderBy(query.sort),
          skip,
          take,
          include: {
            product: { select: { id: true, name: true, slug: true, image: true } },
            user: { select: { email: true, avatarUrl: true } },
          },
        }),
    });
  }

  async adminStats() {
    const [byStatus, featured, archived, avg, unreplied] = await Promise.all([
      this.prisma.productReview.groupBy({ by: ['status'], where: { archivedAt: null }, _count: { _all: true } }),
      this.prisma.productReview.count({ where: { ...VISIBLE, featured: true } }),
      this.prisma.productReview.count({ where: { archivedAt: { not: null } } }),
      this.prisma.productReview.aggregate({ where: VISIBLE, _avg: { rating: true } }),
      this.prisma.productReview.count({ where: { ...VISIBLE, adminReply: null, rating: { lte: 3 } } }),
    ]);
    const count = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    return {
      published: count('PUBLISHED'),
      hidden: count('HIDDEN'),
      featured,
      archived,
      averageRating: Math.round((avg._avg.rating ?? 0) * 10) / 10,
      /** 1–3 star reviews still waiting for a reply */
      needsReply: unreplied,
    };
  }

  async adminUpdate(id: string, input: AdminUpdateReviewInput) {
    const review = await this.findOrThrow(id);
    const data: Prisma.ProductReviewUpdateInput = {};

    if (input.status !== undefined) data.status = input.status;
    const willBeVisible = (input.status ?? review.status) === 'PUBLISHED';
    if (input.featured !== undefined) {
      if (input.featured && !willBeVisible) throw new ConflictException('Show the review before featuring it on the homepage.');
      data.featured = input.featured;
      data.featuredAt = input.featured ? (review.featured ? review.featuredAt : new Date()) : null;
    }
    // Hiding a review also takes it off the homepage.
    if (!willBeVisible && review.featured) {
      data.featured = false;
      data.featuredAt = null;
    }

    const wording = (['rating', 'title', 'body'] as const).filter((k) => input[k] !== undefined && input[k] !== review[k]);
    for (const k of wording) (data as Record<string, unknown>)[k] = input[k];
    if (wording.some((k) => k !== 'rating')) data.editedByAdmin = true;
    if (input.authorName !== undefined) data.authorName = input.authorName;

    if (input.adminReply !== undefined) {
      data.adminReply = input.adminReply || null;
      data.adminReplyAt = input.adminReply ? new Date() : null;
    }

    const updated = await this.prisma.productReview.update({ where: { id }, data });
    await this.syncProductRating(review.productId);
    return updated;
  }

  async archive(id: string) {
    const review = await this.findOrThrow(id);
    const updated = await this.prisma.productReview.update({
      where: { id },
      data: { archivedAt: review.archivedAt ?? new Date(), featured: false, featuredAt: null },
    });
    await this.syncProductRating(review.productId);
    return updated;
  }

  async unarchive(id: string) {
    const review = await this.findOrThrow(id);
    const updated = await this.prisma.productReview.update({ where: { id }, data: { archivedAt: null } });
    await this.syncProductRating(review.productId);
    return updated;
  }

  async remove(id: string) {
    const review = await this.findOrThrow(id);
    assertArchivedBeforeDelete(review, `Review by ${review.authorName}`);
    await this.prisma.productReview.delete({ where: { id } });
    return { ok: true as const };
  }

  // ---- Helpers ---------------------------------------------------------------------

  async summaryFor(productId: string): Promise<RatingSummary> {
    const rows = await this.prisma.productReview.groupBy({ by: ['rating'], where: { ...VISIBLE, productId }, _count: { _all: true } });
    return summarise(rows.map((r) => ({ rating: r.rating, count: r._count._all })));
  }

  /** Keeps Product.rating / reviewCount (used by cards, search and sorting) in step. */
  async syncProductRating(productId: string) {
    const { average, count } = await this.summaryFor(productId);
    await this.prisma.product.update({ where: { id: productId }, data: { rating: average, reviewCount: count } });
  }

  /** True when a paid, delivered order of this customer contains the product (on its own or in a bundle). */
  private async hasBought(userId: string, productId: string) {
    return (await this.deliveredPurchases(userId)).has(productId);
  }

  /**
   * productId → the latest paid, delivered order it was in.
   * Same ownership rule as "My orders": linked to the account, or placed with the account's email
   * (guest checkouts, and orders whose account link was lost).
   */
  private async deliveredPurchases(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const email = user?.email?.trim().toLowerCase();
    const orders = await this.prisma.order.findMany({
      where: { ...REVIEWABLE_ORDER, OR: [{ userId }, ...(email ? [{ customerEmail: email }] : [])] },
      orderBy: { updatedAt: 'desc' },
      select: { orderNumber: true, updatedAt: true, items: { select: { productId: true } } },
    });
    const bought = new Map<string, { orderNumber: string; deliveredAt: Date }>();
    for (const order of orders) {
      for (const item of order.items) {
        for (const id of productIdsInOrderLine(item.productId)) {
          if (!bought.has(id)) bought.set(id, { orderNumber: order.orderNumber, deliveredAt: order.updatedAt });
        }
      }
    }
    return bought;
  }

  private async findPublicProduct(ref: string) {
    const product = await this.prisma.product.findFirst({
      where: { ...PUBLIC_PRODUCT_WHERE, OR: [{ id: ref }, { slug: ref }] },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private async findOrThrow(id: string) {
    const review = await this.prisma.productReview.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');
    return review;
  }
}

