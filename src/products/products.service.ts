import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  archiveWhere,
  assertAllArchivedBeforeDelete,
  assertArchivedBeforeDelete,
  resolveArchiveFilter,
} from '../common/archive/archive.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MediaService } from '../media/media.service.js';
import { RedisService } from '../redis/redis.service.js';
import { priceFromOptions, readSupplyOptions } from './supply-options.js';
import { WellnessHubService } from '../wellness-hub/wellness-hub.service.js';
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


const PRODUCT_LIST_CACHE_TTL_SECONDS = 180;
const PRODUCT_ONE_CACHE_TTL_SECONDS = 300;
const PRODUCT_SEARCH_CACHE_TTL_SECONDS = 120;

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
    @Optional() private readonly wellnessHub?: WellnessHubService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  private async invalidateProductCaches() {
    this.tagIndexCache = null;
    await Promise.all([
      this.redis?.delByPrefix('products:'),
      this.redis?.delByPrefix('wellness-hub:'),
    ]);
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
    if (!this.redis) {
      return this.loadSearch(query);
    }
    const cacheKey = `products:search:${JSON.stringify({
      q: query.q ?? '',
      category: query.category ?? [],
      brand: query.brand ?? [],
      flag: query.flag ?? [],
      min: query.min ?? null,
      max: query.max ?? null,
      sort: query.sort ?? '',
      page: query.page,
      limit: query.limit,
    })}`;
    return this.redis.wrap(cacheKey, PRODUCT_SEARCH_CACHE_TTL_SECONDS, () =>
      this.loadSearch(query),
    );
  }

  private async loadSearch(query: ProductSearchQuery) {
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
    if (isAdmin || !this.redis) {
      return this.loadAll(query, isAdmin);
    }
    const cacheKey = `products:list:${JSON.stringify({
      q: query.q ?? '',
      category: query.category ?? '',
      brand: query.brand ?? '',
      tag: query.tag ?? '',
      featured: query.featured ?? '',
      sort: query.sort ?? '',
      page: query.page ?? 1,
      limit: query.limit ?? 50,
    })}`;
    return this.redis.wrap(cacheKey, PRODUCT_LIST_CACHE_TTL_SECONDS, () =>
      this.loadAll(query, false),
    );
  }

  private async loadAll(query: Partial<QueryProductInput> = {}, isAdmin = false) {
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
    if (isAdmin || !this.redis) {
      return this.loadOne(idOrSlug, isAdmin);
    }
    return this.redis.wrap(
      `products:one:${idOrSlug}`,
      PRODUCT_ONE_CACHE_TTL_SECONDS,
      () => this.loadOne(idOrSlug, false),
    );
  }

  private async loadOne(idOrSlug: string, isAdmin = false) {
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
    // Every product is sold through its purchase options (weekly / monthly supplies).
    if (!input.supplyOptions?.length) {
      throw new BadRequestException('Add at least one purchase option (e.g. "1 Month Supply") with its price.');
    }
    const optionPrice = priceFromOptions(input.supplyOptions);
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
        // Price comes from the purchase options (the cheapest one).
        price: optionPrice?.price ?? input.price,
        originalPrice: optionPrice ? optionPrice.originalPrice : (input.originalPrice ?? null),
        discountPercent: optionPrice?.discountPercent ?? input.discountPercent ?? 0,
        taxIncluded: input.taxIncluded ?? true,
        taxType: input.taxType ?? 'percent',
        taxValue: input.taxIncluded === false ? (input.taxValue ?? 0) : 0,
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
        image: input.image ?? '',
        gallery: (input.gallery && input.gallery.length > 0
          ? input.gallery
          : input.image ? [input.image] : []) as unknown as Prisma.InputJsonValue,
        sizes: (input.sizes as Prisma.InputJsonValue) ?? null,
        supplyDuration: input.supplyDuration ?? '1 Month',
        packsPerMonth: input.packsPerMonth ?? 1,
        supplyOptions: (input.supplyOptions ?? []) as unknown as Prisma.InputJsonValue,
        subscriptionEnabled: Boolean(input.subscriptionEnabled && input.supplyOptions?.length),
      },
    });

    this.logger.log(`Created product "${product.name}" with ID: ${product.id}`);
    if (input.hubGroupIds) await this.wellnessHub?.setProductGroups(product.id, input.hubGroupIds);
    await this.invalidateProductCaches();
    return product;
  }

  async update(id: string, input: UpdateProductInput) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Product with ID "${id}" not found`);
    }
    if (input.supplyOptions && input.supplyOptions.length === 0) {
      throw new BadRequestException('A product needs at least one purchase option.');
    }
    // New options → new shop price; otherwise keep the price in step with the options it already has.
    const optionPrice = priceFromOptions(input.supplyOptions ?? readSupplyOptions(existing.supplyOptions));

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
        // With purchase options the price is theirs (cheapest option); otherwise keep the old fields.
        ...(optionPrice
          ? { price: optionPrice.price, originalPrice: optionPrice.originalPrice, discountPercent: optionPrice.discountPercent }
          : {
              ...(input.price !== undefined && { price: input.price }),
              ...(input.originalPrice !== undefined && { originalPrice: input.originalPrice }),
              ...(input.discountPercent !== undefined && { discountPercent: input.discountPercent }),
            }),
        ...(input.taxIncluded !== undefined && { taxIncluded: input.taxIncluded }),
        ...(input.taxType !== undefined && { taxType: input.taxType }),
        ...(input.taxValue !== undefined && { taxValue: input.taxIncluded === true ? 0 : input.taxValue }),
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
        ...(input.supplyDuration !== undefined && { supplyDuration: input.supplyDuration }),
        ...(input.packsPerMonth !== undefined && { packsPerMonth: input.packsPerMonth }),
        ...(input.supplyOptions !== undefined && { supplyOptions: input.supplyOptions as unknown as Prisma.InputJsonValue }),
        ...(input.subscriptionEnabled !== undefined && { subscriptionEnabled: input.subscriptionEnabled }),
      },
    });

    this.logger.log(`Updated product "${updated.name}" (${updated.id})`);
    if (input.hubGroupIds) await this.wellnessHub?.setProductGroups(updated.id, input.hubGroupIds);
    await this.invalidateProductCaches();
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
    await this.invalidateProductCaches();
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
    await this.invalidateProductCaches();
    this.logger.log(`Restored product "${existing.name}" (${id})`);
    return restored;
  }

  async archiveMany(ids: string[]) {
    const result = await this.prisma.product.updateMany({
      where: { id: { in: ids }, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (result.count > 0) await this.invalidateProductCaches();
    this.logger.log(`Archived ${result.count} products`);
    return { ok: true as const, count: result.count };
  }

  async unarchiveMany(ids: string[]) {
    const result = await this.prisma.product.updateMany({
      where: { id: { in: ids }, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
    if (result.count > 0) await this.invalidateProductCaches();
    this.logger.log(`Restored ${result.count} products`);
    return { ok: true as const, count: result.count };
  }

  /** Permanent delete. Throws 409 if the product is not archived. */
  async remove(id: string) {
    const existing = await this.findByIdOrThrow(id);
    assertArchivedBeforeDelete(existing, `Product "${existing.name}"`);

    await this.prisma.product.delete({ where: { id } });
    await this.wellnessHub?.removeProducts([id]);
    await this.invalidateProductCaches();
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
    await this.wellnessHub?.removeProducts(products.filter((p) => p.archivedAt).map((p) => p.id));
    if (result.count > 0) await this.invalidateProductCaches();
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
