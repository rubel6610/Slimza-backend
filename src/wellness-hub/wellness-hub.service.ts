import { Injectable, Logger, NotFoundException, Optional, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { DEFAULT_CMS_DATA } from '../cms/cms.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PUBLIC_PRODUCT_WHERE } from '../products/product-search.js';
import { RedisService } from '../redis/redis.service.js';
import {
  buildHubFromCategories,
  parseWellnessHubForSave,
  removeProductsFromHub,
  setProductGroups,
  WELLNESS_HUB_CMS_KEY,
  type WellnessHubConfig,
} from './wellness-hub-config.js';

const WELLNESS_HUB_CACHE_TTL_SECONDS = 300;

/** Wellness Product Hub groups (config in wellness-hub-config.ts). */
@Injectable()
export class WellnessHubService implements OnModuleInit {
  private readonly logger = new Logger(WellnessHubService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async onModuleInit() {
    await this.seedFromCategoriesIfMissing().catch((err) => this.logger.warn(`Wellness hub seed skipped: ${String(err)}`));
  }

  /**
   * One-off: the homepage hub used to show the shop categories. The first time this runs, the hub
   * gets one group per category (same name, image, order) holding that category's products.
   * After that the hub and the categories are edited separately.
   */
  async seedFromCategoriesIfMissing() {
    const existing = await this.prisma.cmsSection.findUnique({ where: { key: WELLNESS_HUB_CMS_KEY }, select: { key: true } });
    if (existing) return;
    const categories = await this.prisma.cmsSection.findUnique({ where: { key: 'categories' } });
    const products = await this.prisma.product.findMany({
      where: PUBLIC_PRODUCT_WHERE,
      orderBy: [{ featuredRank: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, category: true, categories: true },
    });
    const hub = buildHubFromCategories(categories?.data ?? DEFAULT_CMS_DATA.categories, products);
    await this.prisma.cmsSection.create({ data: { key: WELLNESS_HUB_CMS_KEY, data: hub as unknown as Prisma.InputJsonValue } });
    await this.invalidateCache();
    this.logger.log(`Created the Wellness Product Hub from ${hub.groups.length} categories`);
  }

  async getConfig(): Promise<WellnessHubConfig> {
    const record = await this.prisma.cmsSection.findUnique({ where: { key: WELLNESS_HUB_CMS_KEY } });
    const parsed = parseWellnessHubForSave(record?.data);
    return parsed.ok ? parsed.data : { enabled: true, title: 'Wellness Product Hub', groups: [] };
  }

  /** Product form: put this product in exactly these hub groups. */
  async setProductGroups(productId: string, groupIds: string[]) {
    await this.change((config) => setProductGroups(config, productId, groupIds));
  }

  /** Permanently deleted products leave every group. */
  async removeProducts(productIds: string[]) {
    if (productIds.length) await this.change((config) => removeProductsFromHub(config, productIds));
  }

  /** Read → change → write the stored hub (archived groups included). Skips if it isn't stored yet. */
  private async change(fn: (config: WellnessHubConfig) => WellnessHubConfig) {
    const record = await this.prisma.cmsSection.findUnique({ where: { key: WELLNESS_HUB_CMS_KEY } });
    if (!record) return;
    const parsed = parseWellnessHubForSave(record.data);
    if (!parsed.ok) {
      this.logger.warn(`Wellness hub not updated, stored data is invalid: ${parsed.message}`);
      return;
    }
    const next = fn(parsed.data);
    if (JSON.stringify(next) === JSON.stringify(parsed.data)) return;
    await this.prisma.cmsSection.update({ where: { key: WELLNESS_HUB_CMS_KEY }, data: { data: next as unknown as Prisma.InputJsonValue } });
    await this.invalidateCache();
  }

  private async invalidateCache() {
    await this.redis?.delByPrefix('wellness-hub:');
  }

  /** Group page: the group and its products, in the admin's order (hidden / unpublished products left out). */
  async publicGroup(slug: string) {
    if (!this.redis) {
      return this.loadPublicGroup(slug);
    }
    return this.redis.wrap(`wellness-hub:group:${slug}`, WELLNESS_HUB_CACHE_TTL_SECONDS, () =>
      this.loadPublicGroup(slug),
    );
  }

  private async loadPublicGroup(slug: string) {
    const config = await this.getConfig();
    const group = config.groups.find((g) => g.slug === slug && g.active && !g.archivedAt);
    if (!group) throw new NotFoundException('This collection was not found');
    const rows = await this.prisma.product.findMany({ where: { ...PUBLIC_PRODUCT_WHERE, id: { in: group.productIds } } });
    const byId = new Map(rows.map((p) => [p.id, p]));
    const { productIds, archivedAt: _a, active: _b, ...info } = group;
    return { group: info, products: productIds.flatMap((id) => byId.get(id) ?? []) };
  }
}
