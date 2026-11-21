import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  archiveWhere,
  assertAllArchivedBeforeDelete,
  assertArchivedBeforeDelete,
  resolveArchiveFilter,
} from '../common/archive/archive.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MediaService } from '../media/media.service.js';
import {
  PUBLIC_PRODUCT_WHERE,
  brandWhere,
  buildPageMeta,
  categoryWhere,
  flagWhere,
  parseSearchTerms,
  priceWhere,
  searchOrderBy,
  searchTermsWhere,
  slugifyTag,
  toSkipTake,
  type ProductSearchQuery,
  type SearchFacets,
} from './product-search.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateProductInput,
  QueryProductInput,
  UpdateProductInput,
} from './products.schemas.js';

export interface UploadedProductFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

export const INITIAL_PRODUCTS = [
  {
    slug: 'slimza-detox-elixir',
    name: 'Slimza Detox Elixir “Buy One, Get One Free”',
    description: "A gentle herbal infusion to cleanse, refresh and support your body's natural detox.",
    category: 'cleanse-reset',
    brand: 'slimza-teas',
    tags: ['Best Selling', 'Offered Items'],
    price: 27.99,
    originalPrice: 55.98,
    discountPercent: 50,
    rating: 5,
    reviewCount: 128,
    stockQuantity: 12,
    stockStatus: 'In Stock',
    publishStatus: 'published',
    image: '/products/tea/teatox-green.png',
    gallery: [
      '/products/tea/teatox-green.png',
      '/products/tea/teatox-duo.png',
      '/products/tea/teatox-white.png',
    ],
    featured: true,
    featuredRank: 1,
    offered: true,
  },
  {
    slug: 'shilajit-resin',
    name: 'Himalayan Shilajit Resin',
    description: 'Pure Himalayan shilajit for natural energy, stamina and focus — just a pea-sized amount a day.',
    category: 'peak-performance',
    brand: 'slimza-pure',
    tags: ['Best Selling', 'Offered Items'],
    price: 39.99,
    originalPrice: 49.99,
    discountPercent: 20,
    rating: 4.9,
    reviewCount: 214,
    stockQuantity: 8,
    stockStatus: 'In Stock',
    publishStatus: 'published',
    image: '/products/shilajit/shilajit-resin.png',
    gallery: ['/products/shilajit/shilajit-resin.png', '/products/shilajit/shilajit-coffee.png'],
    featured: true,
    featuredRank: 2,
    offered: true,
  },
  {
    slug: 'teatox-green-white-duo',
    name: 'Slimza Active Body Teatox Duo – Feel Great Naturally',
    description: 'Our green & white Teatox pouches together — 100% natural, 2 cups a day, 30 teabags each for a complete detox routine.',
    category: 'daily-energy',
    brand: 'slimza-teas',
    tags: ['Best Selling'],
    price: 22.5,
    rating: 4.8,
    reviewCount: 96,
    stockQuantity: 30,
    stockStatus: 'In Stock',
    publishStatus: 'published',
    image: '/products/tea/teatox-double.jpg',
    gallery: [
      '/products/tea/teatox-double.jpg',
      '/products/tea/teatox-single.jpg',
      '/shop-categories/teatox.jpg',
    ],
    featured: true,
    featuredRank: 3,
  },
  {
    slug: 'teatox-where-feeling-good-begins',
    name: 'Slimza Active Body Teatox – Where Feeling Good Begins',
    description: 'The original white Slimza Teatox — 100% natural herbal teabags, 2 cups a day, 30 teabags for radiant, feel-good wellness.',
    category: 'radiance-beauty',
    brand: 'slimza-teas',
    tags: ['Offered Items', 'Seasonal Stock'],
    price: 34.99,
    originalPrice: 42.99,
    discountPercent: 19,
    rating: 4.7,
    reviewCount: 73,
    stockQuantity: 20,
    stockStatus: 'In Stock',
    publishStatus: 'published',
    image: '/products/tea/teatox-single.jpg',
    gallery: ['/products/tea/teatox-single.jpg', '/products/tea/teatox-double.jpg'],
    featured: true,
    featuredRank: 4,
    offered: true,
  },
  {
    slug: 'slimza-morning-fresh-tea',
    name: 'Slimza Active Body Teatox – Feel Fresh, Look Radiant',
    description: 'Our classic green Teatox pouch — gentle morning detox tea, 30 teabags packed with organic cleansing herbs.',
    category: 'cleanse-reset',
    brand: 'slimza-teas',
    tags: ['New Arrival', 'Best Selling'],
    price: 19.99,
    rating: 4.9,
    reviewCount: 142,
    stockQuantity: 25,
    stockStatus: 'In Stock',
    publishStatus: 'published',
    image: '/products/tea/teatox-duo.png',
    gallery: ['/products/tea/teatox-duo.png', '/products/tea/teatox-green.png'],
    featured: true,
    featuredRank: 5,
  },
  {
    slug: 'matcha-ceremonial-grade',
    name: 'Japanese Ceremonial Grade Matcha',
    description: 'First-harvest Uji matcha powder for clean, jitter-free energy and calm mental focus.',
    category: 'daily-energy',
    brand: 'slimza-superfoods',
    tags: ['Best Selling'],
    price: 29.99,
    rating: 5,
    reviewCount: 88,
    stockQuantity: 15,
    stockStatus: 'In Stock',
    publishStatus: 'published',
    image: '/products/product-details.jpg',
    gallery: ['/products/product-details.jpg'],
    featured: true,
    featuredRank: 6,
  },
  {
    slug: 'himalayan-shilajit-capsules',
    name: 'Himalayan Shilajit Capsules (600mg)',
    description: 'Purified gold-grade shilajit in easy vegetarian capsules, rich in fulvic acid and trace minerals.',
    category: 'peak-performance',
    brand: 'slimza-pure',
    tags: ['New Arrival'],
    price: 32.5,
    rating: 4.8,
    reviewCount: 54,
    stockQuantity: 40,
    stockStatus: 'In Stock',
    publishStatus: 'published',
    image: '/shop-categories/Pure Shilajit Resin.png',
    gallery: ['/shop-categories/Pure Shilajit Resin.png'],
    featured: false,
    featuredRank: 7,
  },
  {
    slug: 'glow-marine-collagen',
    name: 'Glow Marine Collagen Peptides',
    description: 'Wild-caught hydrolyzed marine collagen with Vitamin C and hyaluronic acid for skin and hair radiance.',
    category: 'radiance-beauty',
    brand: 'slimza-pure',
    tags: ['Best Selling', 'Offered Items'],
    price: 36.99,
    originalPrice: 44.99,
    discountPercent: 18,
    rating: 4.9,
    reviewCount: 167,
    stockQuantity: 18,
    stockStatus: 'In Stock',
    publishStatus: 'published',
    image: '/shop-categories/sleep.png',
    gallery: ['/shop-categories/sleep.png'],
    featured: false,
    featuredRank: 8,
    offered: true,
  },
  {
    slug: 'bovine-collagen-peptides',
    name: 'Pure Grass-Fed Bovine Collagen (Type I & III)',
    description: 'Pasture-raised, unflavoured multi-collagen protein for joints, tendons, gut lining and recovery.',
    category: 'restore-renew',
    brand: 'slimza-pure',
    tags: ['New Arrival'],
    price: 28.99,
    rating: 4.8,
    reviewCount: 62,
    stockQuantity: 22,
    stockStatus: 'In Stock',
    publishStatus: 'published',
    image: '/shop-categories/sleep.png',
    gallery: ['/shop-categories/sleep.png'],
    featured: false,
    featuredRank: 9,
  },
  {
    slug: 'shilajit-infused-coffee',
    name: 'Artisan Shilajit & Lion’s Mane Coffee',
    description: 'Medium roast Colombian Arabica infused with raw Himalayan shilajit and organic Lion’s Mane mushroom.',
    category: 'daily-energy',
    brand: 'slimza-coffee',
    tags: ['Best Selling'],
    price: 21.99,
    rating: 4.9,
    reviewCount: 95,
    stockQuantity: 14,
    stockStatus: 'In Stock',
    publishStatus: 'published',
    image: '/products/shilajit/shilajit-coffee.png',
    gallery: ['/products/shilajit/shilajit-coffee.png'],
    featured: false,
    featuredRank: 10,
  },
  {
    slug: 'functional-mushroom-blend',
    name: '7-Mushroom Super Blend (Reishi, Chaga, Cordyceps)',
    description: 'Potent dual-extracted adaptogenic mushroom powder to strengthen immune resilience and clarity.',
    category: 'total-wellness',
    brand: 'slimza-superfoods',
    tags: ['Seasonal Stock'],
    price: 26.5,
    rating: 4.7,
    reviewCount: 41,
    stockQuantity: 16,
    stockStatus: 'In Stock',
    publishStatus: 'published',
    image: '/shop-categories/Wellness Supplements.png',
    gallery: ['/shop-categories/Wellness Supplements.png'],
    featured: false,
    featuredRank: 11,
  },
  {
    slug: 'active-body-slimming-tea',
    name: 'Active Body Herbal Slimming Infusion',
    description: 'Gentle botanical infusion crafted with garcinia, dandelion leaf and green tea to support natural metabolism.',
    category: 'cleanse-reset',
    brand: 'slimza-teas',
    tags: ['Offered Items'],
    price: 18.99,
    originalPrice: 24.99,
    discountPercent: 24,
    rating: 4.6,
    reviewCount: 83,
    stockQuantity: 35,
    stockStatus: 'In Stock',
    publishStatus: 'published',
    image: '/products/tea/teatox-green.png',
    gallery: ['/products/tea/teatox-green.png'],
    featured: false,
    featuredRank: 12,
    offered: true,
  },
  {
    slug: 'pure-organic-ashwagandha',
    name: 'KSM-66 Organic Ashwagandha Root (500mg)',
    description: 'Clinically studied full-spectrum root extract to regulate cortisol, calm daily stress and promote restful sleep.',
    category: 'restore-renew',
    brand: 'slimza-pure',
    tags: ['Best Selling'],
    price: 24.99,
    rating: 4.9,
    reviewCount: 112,
    stockQuantity: 28,
    stockStatus: 'In Stock',
    publishStatus: 'published',
    image: '/shop-categories/Wellness Supplements.png',
    gallery: ['/shop-categories/Wellness Supplements.png'],
    featured: false,
    featuredRank: 13,
  },
  {
    slug: 'electrolyte-hydration-orange',
    name: 'Hydration Electrolytes + Trace Minerals (Orange)',
    description: 'Zero-sugar rapid hydration stick packs with magnesium glycinate, potassium, pink salt and fulvic minerals.',
    category: 'total-wellness',
    brand: 'slimza-pure',
    tags: ['New Arrival'],
    price: 23.99,
    rating: 4.8,
    reviewCount: 49,
    stockQuantity: 50,
    stockStatus: 'In Stock',
    publishStatus: 'published',
    image: '/products/hydration/electrolytes-orange.png',
    gallery: ['/products/hydration/electrolytes-orange.png'],
    featured: false,
    featuredRank: 14,
  },
  {
    slug: 'night-time-relax-infusion',
    name: 'Night Time Herbal Sleep Infusion',
    description: 'Calming bedtime blend of organic chamomile flowers, valerian root, lemon balm and lavender buds.',
    category: 'restore-renew',
    brand: 'slimza-teas',
    tags: ['Seasonal Stock'],
    price: 17.5,
    rating: 4.9,
    reviewCount: 68,
    stockQuantity: 19,
    stockStatus: 'In Stock',
    publishStatus: 'published',
    image: '/shop-categories/teatox.jpg',
    gallery: ['/shop-categories/teatox.jpg'],
    featured: false,
    featuredRank: 15,
  },
  {
    slug: 'magnesium-complex',
    name: 'High-Absorption Triple Magnesium Complex',
    description: 'Chelated bisglycinate, malate and taurate for muscle relaxation, sound sleep and nervous system recovery.',
    category: 'total-wellness',
    brand: 'slimza-pure',
    tags: ['Best Selling'],
    price: 25.99,
    rating: 4.9,
    reviewCount: 137,
    stockQuantity: 24,
    stockStatus: 'In Stock',
    publishStatus: 'published',
    image: '/shop-categories/Wellness Supplements.png',
    gallery: ['/shop-categories/Wellness Supplements.png'],
    featured: false,
    featuredRank: 16,
  },
];

@Injectable()
export class ProductsService implements OnModuleInit {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
  ) {}

  async onModuleInit() {
    await this.ensureUploadsDirectory();
    await this.seedInitialProductsIfEmpty();
  }

  private async ensureUploadsDirectory() {
    const dir = join(process.cwd(), 'uploads', 'products');
    await mkdir(dir, { recursive: true });
  }

  private async seedInitialProductsIfEmpty() {
    try {
      const count = await this.prisma.product.count();
      if (count === 0) {
        this.logger.log('Seeding initial 16 catalog products into PostgreSQL database...');
        for (const item of INITIAL_PRODUCTS) {
          await this.prisma.product.create({
            data: {
              slug: item.slug,
              name: item.name,
              description: item.description,
              category: item.category,
              brand: item.brand,
              tags: item.tags,
              price: item.price,
              originalPrice: item.originalPrice ?? null,
              discountPercent: item.discountPercent ?? 0,
              rating: item.rating,
              reviewCount: item.reviewCount,
              stockQuantity: item.stockQuantity,
              stockStatus: item.stockStatus,
              publishStatus: item.publishStatus,
              image: item.image,
              gallery: item.gallery,
              featured: item.featured ?? false,
              featuredRank: item.featuredRank ?? 99,
              offered: item.offered ?? false,
              taxIncluded: true,
              unlimitedStock: false,
            },
          });
        }
        this.logger.log('Initial 16 products successfully seeded!');
      }
    } catch (err) {
      this.logger.warn(`Failed to seed initial products: ${String(err)}`);
    }
  }

  private slugify(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'product'
    );
  }

  private async generateUniqueSlug(baseSlug: string, existingId?: string): Promise<string> {
    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const found = await this.prisma.product.findUnique({ where: { slug } });
      if (!found || (existingId && found.id === existingId)) {
        return slug;
      }
      slug = `${baseSlug}-${counter}`;
      counter += 1;
    }
  }

  /**
   * @param isAdmin Only admins may list archived products (`query.archived`).
   *                Everyone else always gets live products only.
   */
  // ---- Storefront search (GET /products/search) -------------------------------------
  // Engine: src/products/product-search.ts. Returns { items, meta, facets }.

  /** Tag spellings per flag slug ("best-selling" → ["Best Selling"]), cached for a minute. */
  private tagIndexCache: { at: number; map: Map<string, string[]> } | null = null;

  private async tagIndex(): Promise<Map<string, string[]>> {
    if (this.tagIndexCache && Date.now() - this.tagIndexCache.at < 60_000) return this.tagIndexCache.map;
    const rows = await this.prisma.product.findMany({ where: PUBLIC_PRODUCT_WHERE, select: { tags: true } });
    const map = new Map<string, Set<string>>();
    for (const row of rows) {
      for (const tag of Array.isArray(row.tags) ? row.tags : []) {
        if (typeof tag !== 'string' || !tag.trim()) continue;
        const slug = slugifyTag(tag);
        if (!map.has(slug)) map.set(slug, new Set());
        map.get(slug)!.add(tag);
      }
    }
    const result = new Map([...map].map(([slug, tags]) => [slug, [...tags]]));
    this.tagIndexCache = { at: Date.now(), map: result };
    return result;
  }

  async search(query: ProductSearchQuery) {
    const terms = parseSearchTerms(query.q);
    const searching = terms.fulltext.length + terms.short.length > 0;
    const sort = query.sort ?? (searching ? 'relevance' : 'default');
    const tagsBySlug = await this.tagIndex();

    // Each filter is built once; facets re-use them while leaving their own filter out
    // ("how many products would I get if I ticked this brand too?").
    const parts = {
      base: [PUBLIC_PRODUCT_WHERE, ...searchTermsWhere(terms)],
      category: categoryWhere(query.category),
      brand: brandWhere(query.brand),
      flags: flagWhere(query.flag, tagsBySlug),
      price: priceWhere(query.min, query.max),
    };
    const build = (omit?: 'category' | 'brand' | 'flags'): Prisma.ProductWhereInput => ({
      AND: [
        ...parts.base,
        omit === 'category' ? {} : parts.category,
        omit === 'brand' ? {} : parts.brand,
        ...(omit === 'flags' ? [] : parts.flags),
        parts.price,
      ],
    });
    const where = build();

    const [total, items, facets] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({ where, orderBy: searchOrderBy(sort, terms), ...toSkipTake(query) }),
      this.searchFacets(build, tagsBySlug),
    ]);

    return {
      items,
      meta: buildPageMeta(query.page, query.limit, total),
      facets,
      sort,
      terms: [...terms.fulltext, ...terms.short],
    };
  }

  /** Counts for the filter sidebar, computed in the database. */
  private async searchFacets(
    build: (omit?: 'category' | 'brand' | 'flags') => Prisma.ProductWhereInput,
    tagsBySlug: Map<string, string[]>,
  ): Promise<SearchFacets> {
    const [brandGroups, categoryGroups, cmsCategories] = await Promise.all([
      this.prisma.product.groupBy({ by: ['brand'], where: build('brand'), _count: { _all: true } }),
      this.prisma.product.groupBy({ by: ['category'], where: build('category'), _count: { _all: true } }),
      this.prisma.cmsSection.findUnique({ where: { key: 'categories' } }),
    ]);

    // Products can sit in several categories (the `categories` JSON list), so each
    // category is counted on its own: primary category OR listed in `categories`.
    const cmsSlugs = Array.isArray(cmsCategories?.data)
      ? (cmsCategories.data as Array<{ slug?: unknown }>).map((c) => c.slug).filter((s): s is string => typeof s === 'string')
      : [];
    const categorySlugs = [...new Set([...categoryGroups.map((g) => g.category), ...cmsSlugs])].filter(Boolean).slice(0, 40);
    const flagSlugs = [...tagsBySlug.keys()].slice(0, 40);

    const [categoryCounts, flagCounts] = await Promise.all([
      Promise.all(categorySlugs.map((slug) => this.prisma.product.count({ where: { AND: [build('category'), categoryWhere([slug])] } }))),
      Promise.all(flagSlugs.map((slug) => this.prisma.product.count({ where: { AND: [build('flags'), ...flagWhere([slug], tagsBySlug)] } }))),
    ]);

    return {
      brands: Object.fromEntries(brandGroups.filter((g) => g.brand).map((g) => [g.brand, g._count._all])),
      categories: Object.fromEntries(categorySlugs.map((slug, i) => [slug, categoryCounts[i]]).filter(([, n]) => (n as number) > 0)),
      flags: Object.fromEntries(
        flagSlugs
          .map((slug, i) => [slug, { name: tagsBySlug.get(slug)?.[0] ?? slug, count: flagCounts[i] }] as const)
          .filter(([, v]) => v.count > 0),
      ),
    };
  }

  async findAll(query: Partial<QueryProductInput> = {}, isAdmin = false) {
    // Each condition is pushed into AND, so search + category + brand… all apply together.
    // (Before, the category's OR replaced the search's OR and the search was ignored.)
    const and: Prisma.ProductWhereInput[] = [archiveWhere(resolveArchiveFilter(query.archived, isAdmin))];

    if (query.q) {
      and.push(...searchTermsWhere(parseSearchTerms(query.q)));
    }

    if (query.category) {
      and.push(categoryWhere(query.category.split(',').map((c) => c.trim()).filter(Boolean)));
    }

    if (query.brand) {
      and.push(brandWhere(query.brand.split(',').map((b) => b.trim()).filter(Boolean)));
    }

    if (query.tag) {
      and.push({ tags: { array_contains: query.tag } });
    }

    // Drafts are never public, whatever the request asks for.
    if (!isAdmin) {
      and.push({ publishStatus: 'published' });
    } else if (query.publishStatus) {
      and.push({ publishStatus: query.publishStatus });
    }

    if (query.featured) {
      and.push({ featured: query.featured === 'true' });
    }

    const where: Prisma.ProductWhereInput = { AND: and };

    let orderBy: Prisma.ProductOrderByWithRelationInput = { featuredRank: 'asc' };
    if (query.sort === 'price-asc') {
      orderBy = { price: 'asc' };
    } else if (query.sort === 'price-desc') {
      orderBy = { price: 'desc' };
    } else if (query.sort === 'newest') {
      orderBy = { createdAt: 'desc' };
    } else if (query.sort === 'name') {
      orderBy = { name: 'asc' };
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /** Archived products are invisible (404) unless `isAdmin` is true. */
  async findOne(idOrSlug: string, isAdmin = false) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        idOrSlug,
      );

    const product = isUuid
      ? await this.prisma.product.findUnique({ where: { id: idOrSlug } })
      : await this.prisma.product.findUnique({ where: { slug: idOrSlug } });

    if (!product || (product.archivedAt && !isAdmin)) {
      throw new NotFoundException(`Product "${idOrSlug}" not found`);
    }

    return product;
  }

  async create(input: CreateProductInput) {
    const baseSlug = input.slug?.trim() || this.slugify(input.name);
    const slug = await this.generateUniqueSlug(baseSlug);

    const productCategories =
      Array.isArray(input.categories) && input.categories.length > 0
        ? input.categories
        : [input.category || 'cleanse-reset'];

    const primaryCategory = input.category || productCategories[0] || 'cleanse-reset';

    const product = await this.prisma.product.create({
      data: {
        slug,
        name: input.name,
        description: input.description ?? '',
        price: input.price,
        originalPrice: input.originalPrice ?? null,
        discountPercent: input.discountPercent ?? 0,
        taxIncluded: input.taxIncluded ?? true,
        unlimitedStock: input.unlimitedStock ?? false,
        stockQuantity: input.unlimitedStock ? 999 : input.stockQuantity ?? 50,
        stockStatus: input.stockStatus ?? 'In Stock',
        category: primaryCategory,
        categories: productCategories as unknown as Prisma.InputJsonValue,
        brand: input.brand ?? 'slimza-teas',
        tags: (input.tags ?? []) as unknown as Prisma.InputJsonValue,
        publishStatus: input.publishStatus ?? 'published',
        featured: input.featured ?? false,
        featuredRank: input.featuredRank ?? 99,
        offered: input.offered ?? false,
        image: input.image ?? '/products/tea/teatox-green.png',
        gallery: (input.gallery && input.gallery.length > 0
          ? input.gallery
          : [input.image || '/products/tea/teatox-green.png']) as unknown as Prisma.InputJsonValue,
        sizes: (input.sizes as Prisma.InputJsonValue) ?? null,
        variations: (input.variations as Prisma.InputJsonValue) ?? null,
        supplyDuration: input.supplyDuration ?? '1 Month',
        packsPerMonth: input.packsPerMonth ?? 1,
      },
    });

    this.logger.log(`Created product "${product.name}" with ID: ${product.id}`);
    return product;
  }

  async update(id: string, input: UpdateProductInput) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Product with ID "${id}" not found`);
    }

    let slug = existing.slug;
    if (input.slug && input.slug !== existing.slug) {
      slug = await this.generateUniqueSlug(input.slug, id);
    } else if (input.name && input.name !== existing.name && !input.slug) {
      slug = await this.generateUniqueSlug(this.slugify(input.name), id);
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        slug,
        ...(input.description !== undefined && { description: input.description }),
        ...(input.price !== undefined && { price: input.price }),
        ...(input.originalPrice !== undefined && { originalPrice: input.originalPrice }),
        ...(input.discountPercent !== undefined && { discountPercent: input.discountPercent }),
        ...(input.taxIncluded !== undefined && { taxIncluded: input.taxIncluded }),
        ...(input.unlimitedStock !== undefined && { unlimitedStock: input.unlimitedStock }),
        ...(input.stockQuantity !== undefined && { stockQuantity: input.stockQuantity }),
        ...(input.stockStatus !== undefined && { stockStatus: input.stockStatus }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.categories !== undefined && {
          categories: input.categories as unknown as Prisma.InputJsonValue,
        }),
        ...(input.brand !== undefined && { brand: input.brand }),
        ...(input.tags !== undefined && {
          tags: input.tags as unknown as Prisma.InputJsonValue,
        }),
        ...(input.publishStatus !== undefined && { publishStatus: input.publishStatus }),
        ...(input.featured !== undefined && { featured: input.featured }),
        ...(input.featuredRank !== undefined && { featuredRank: input.featuredRank }),
        ...(input.offered !== undefined && { offered: input.offered }),
        ...(input.image !== undefined && { image: input.image }),
        ...(input.gallery !== undefined && {
          gallery: input.gallery as unknown as Prisma.InputJsonValue,
        }),
        ...(input.sizes !== undefined && { sizes: input.sizes as Prisma.InputJsonValue }),
        ...(input.variations !== undefined && { variations: input.variations as Prisma.InputJsonValue }),
        ...(input.supplyDuration !== undefined && { supplyDuration: input.supplyDuration }),
        ...(input.packsPerMonth !== undefined && { packsPerMonth: input.packsPerMonth }),
      },
    });

    this.logger.log(`Updated product "${updated.name}" (${updated.id})`);
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Archive lifecycle: live -> archived -> permanently deleted.
  // See src/common/archive/archive.ts for the rules shared by every resource.
  // ---------------------------------------------------------------------------

  private async findByIdOrThrow(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product with ID "${id}" not found`);
    }
    return product;
  }

  /** Hide a product from the storefront. Idempotent. */
  async archive(id: string) {
    const existing = await this.findByIdOrThrow(id);
    if (existing.archivedAt) return existing;

    const archived = await this.prisma.product.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    this.logger.log(`Archived product "${existing.name}" (${id})`);
    return archived;
  }

  /** Restore an archived product to the storefront. Idempotent. */
  async unarchive(id: string) {
    const existing = await this.findByIdOrThrow(id);
    if (!existing.archivedAt) return existing;

    const restored = await this.prisma.product.update({
      where: { id },
      data: { archivedAt: null },
    });
    this.logger.log(`Restored product "${existing.name}" (${id})`);
    return restored;
  }

  async archiveMany(ids: string[]) {
    const result = await this.prisma.product.updateMany({
      where: { id: { in: ids }, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    this.logger.log(`Archived ${result.count} products`);
    return { ok: true as const, count: result.count };
  }

  async unarchiveMany(ids: string[]) {
    const result = await this.prisma.product.updateMany({
      where: { id: { in: ids }, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
    this.logger.log(`Restored ${result.count} products`);
    return { ok: true as const, count: result.count };
  }

  /** Permanent delete. Throws 409 if the product is not archived. */
  async remove(id: string) {
    const existing = await this.findByIdOrThrow(id);
    assertArchivedBeforeDelete(existing, `Product "${existing.name}"`);

    await this.prisma.product.delete({ where: { id } });
    this.logger.log(`Permanently deleted product "${existing.name}" (${id})`);
    return { ok: true as const, id };
  }

  /** Permanent bulk delete. All-or-nothing: throws 409 if any product is still live. */
  async deleteMany(ids: string[]) {
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, archivedAt: true },
    });
    assertAllArchivedBeforeDelete(
      products.map((p) => ({ archivedAt: p.archivedAt, label: `"${p.name}"` })),
    );

    const result = await this.prisma.product.deleteMany({
      where: { id: { in: products.map((p) => p.id) }, archivedAt: { not: null } },
    });
    this.logger.log(`Permanently deleted ${result.count} archived products`);
    return { ok: true as const, count: result.count };
  }

  async saveUploadedFile(file?: UploadedProductFile): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException('Please choose an image file to upload');
    }

    const ext = ALLOWED_MIME_TYPES[file.mimetype];
    if (!ext) {
      throw new BadRequestException('Only JPEG, PNG, WEBP, GIF, or SVG images are allowed');
    }

    if (file.size > 15 * 1024 * 1024) {
      throw new BadRequestException('Image must be 15MB or smaller');
    }

    const safeName = file.originalname
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const filename = `${Date.now()}-${safeName.endsWith(`.${ext}`) ? safeName : `${safeName}.${ext}`}`;

    return this.mediaService.saveAsset('products', filename, file.mimetype, file.buffer);
  }
}
