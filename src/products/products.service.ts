import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Prisma } from '../generated/prisma/client.js';
import { MediaService } from '../media/media.service.js';
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

  async findAll(query: Partial<QueryProductInput> = {}) {
    const where: Prisma.ProductWhereInput = {};

    if (query.q) {
      where.OR = [
        { name: { contains: query.q } },
        { description: { contains: query.q } },
      ];
    }

    if (query.category) {
      const cats = query.category.split(',').map((c) => c.trim()).filter(Boolean);
      if (cats.length === 1) {
        where.OR = [
          { category: cats[0] },
          { categories: { array_contains: cats[0] } },
        ];
      } else if (cats.length > 1) {
        where.OR = [
          { category: { in: cats } },
          ...cats.map((c) => ({ categories: { array_contains: c } })),
        ];
      }
    }

    if (query.brand) {
      const brands = query.brand.split(',').map((b) => b.trim()).filter(Boolean);
      if (brands.length === 1) {
        where.brand = brands[0];
      } else if (brands.length > 1) {
        where.brand = { in: brands };
      }
    }

    if (query.tag) {
      where.tags = { array_contains: query.tag };
    }

    if (query.publishStatus) {
      where.publishStatus = query.publishStatus;
    }

    if (query.featured) {
      where.featured = query.featured === 'true';
    }

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

  async findOne(idOrSlug: string) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        idOrSlug,
      );

    const product = isUuid
      ? await this.prisma.product.findUnique({ where: { id: idOrSlug } })
      : await this.prisma.product.findUnique({ where: { slug: idOrSlug } });

    if (!product) {
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

  async remove(id: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Product with ID "${id}" not found`);
    }

    await this.prisma.product.delete({ where: { id } });
    this.logger.log(`Deleted product "${existing.name}" (${id})`);
    return { ok: true as const, id };
  }

  async deleteMany(ids: string[]) {
    const result = await this.prisma.product.deleteMany({
      where: { id: { in: ids } },
    });
    this.logger.log(`Deleted ${result.count} products`);
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
