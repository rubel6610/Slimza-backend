import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  archiveWhere,
  assertArchivedBeforeDelete,
  type ArchiveFilter,
} from '../common/archive/archive.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  BUNDLE_CMS_KEY,
  parseBundleConfigForSave,
} from '../bundle/bundle-config.js';
import {
  LOYALTY_CMS_KEY,
  parseLoyaltyConfigForSave,
} from '../loyalty/loyalty-config.js';
import {
  CURRENCY_CMS_KEY,
  parseCurrencyConfigForSave,
} from '../currency/currency-config.js';
import {
  parseTestimonialsForSave,
  TESTIMONIALS_CMS_KEY,
} from '../testimonials/testimonials-config.js';
import {
  parseWellnessHubForSave,
  WELLNESS_HUB_CMS_KEY,
} from '../wellness-hub/wellness-hub-config.js';
import { MediaService } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  mergeCmsSectionUpdate,
  removeArchivedCmsItem,
  setCmsItemArchived,
  stripArchivedItems,
  type CmsItem,
} from './cms-archive.js';
import { RedisService } from '../redis/redis.service.js';
import { parseShippingConfigForSave, SHIPPING_CMS_KEY } from '../shipping/shipping-config.js';

export interface UploadedCmsFile {
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


@Injectable()
/**
 * CMS sections (header, banner, policies, shipping, …). All content lives in the database and is
 * edited in the dashboard — there is no default content in code. A section that was never saved
 * returns 404 (the storefront shows nothing for it).
 */
export class CmsService {
  private readonly logger = new Logger(CmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * @param includeArchived Return archived list items too. Only the controller
   *        decides this (admins only); the storefront always gets `false`.
   */
  async getAllSections(
    includeArchived = false,
  ): Promise<Record<string, unknown>> {
    if (includeArchived) {
      return this.loadAllSections(true);
    }

    return this.redis.wrap('cms:all', 300, () => this.loadAllSections(false));
  }

  private async loadAllSections(
    includeArchived: boolean,
  ): Promise<Record<string, unknown>> {
    const records = await this.prisma.cmsSection.findMany();
    const result: Record<string, unknown> = {};

    for (const record of records) {
      result[record.key] = record.data;
    }

    if (!includeArchived) {
      for (const key of Object.keys(result)) {
        result[key] = stripArchivedItems(key, result[key]);
      }
    }

    return result;
  }

  async getSection(key: string, includeArchived = false): Promise<unknown> {
    if (includeArchived) {
      return this.getStoredSectionData(key);
    }

    return this.redis.wrap(`cms:section:${key}`, 300, async () => {
      const data = await this.getStoredSectionData(key);
      return stripArchivedItems(key, data);
    });
  }

  /** Raw stored data (archived items included). */
  private async getStoredSectionData(key: string): Promise<unknown> {
    const record = await this.prisma.cmsSection.findUnique({ where: { key } });
    if (record) return record.data;

    throw new NotFoundException(`CMS section "${key}" not found`);
  }

  private async writeSection(key: string, data: unknown) {
    const updated = await this.prisma.cmsSection.upsert({
      where: { key },
      create: { key, data: data as Prisma.InputJsonValue },
      update: { data: data as Prisma.InputJsonValue },
    });
    await this.redis.del('cms:all', `cms:section:${key}`);
    if (key === WELLNESS_HUB_CMS_KEY) {
      await this.redis.delByPrefix('wellness-hub:');
    } else if (key === 'categories') {
      await this.redis.delByPrefix('products:');
    }
    return {
      ok: true as const,
      key: updated.key,
      data: updated.data as unknown,
    };
  }

  /**
   * Full-section save from the dashboard. For sections with item lists this can
   * edit / add / reorder / archive / restore items, but never remove one: a
   * missing live item → 409. See cms-archive.ts.
   */
  async updateSection(
    key: string,
    data: unknown,
  ): Promise<{ ok: true; key: string; data: unknown }> {
    if (key === BUNDLE_CMS_KEY) {
      // Bundle settings drive checkout pricing, so they are validated strictly.
      const parsed = parseBundleConfigForSave(data);
      if (!parsed.ok) throw new BadRequestException(parsed.message);
      data = parsed.data;
    }
    if (key === LOYALTY_CMS_KEY) {
      // Loyalty settings drive checkout discounts, so they are validated strictly too.
      const parsed = parseLoyaltyConfigForSave(data);
      if (!parsed.ok) throw new BadRequestException(parsed.message);
      data = parsed.data;
    }
    if (key === CURRENCY_CMS_KEY) {
      const parsed = parseCurrencyConfigForSave(data);
      if (!parsed.ok) throw new BadRequestException(parsed.message);
      data = parsed.data;
    }
    if (key === SHIPPING_CMS_KEY) {
      // Shipping prices are charged at checkout, so they are validated strictly.
      const parsed = parseShippingConfigForSave(data);
      if (!parsed.ok) throw new BadRequestException(parsed.message);
      data = parsed.data;
    }
    if (key === WELLNESS_HUB_CMS_KEY) {
      const parsed = parseWellnessHubForSave(data);
      if (!parsed.ok) throw new BadRequestException(parsed.message);
      data = parsed.data;
    }
    if (key === TESTIMONIALS_CMS_KEY) {
      const parsed = parseTestimonialsForSave(data);
      if (!parsed.ok) throw new BadRequestException(parsed.message);
      data = parsed.data;
    }
    const current = await this.getStoredSectionData(key).catch(() => undefined);
    const next =
      current === undefined ? data : mergeCmsSectionUpdate(key, current, data);
    return this.writeSection(key, next);
  }

  // ---- CMS item archive lifecycle (see cms-archive.ts) ----------------------

  async archiveSectionItem(key: string, itemId: string) {
    return this.setSectionItemArchived(key, itemId, true);
  }

  async unarchiveSectionItem(key: string, itemId: string) {
    return this.setSectionItemArchived(key, itemId, false);
  }

  private async setSectionItemArchived(
    key: string,
    itemId: string,
    archived: boolean,
  ): Promise<{ ok: true; key: string; data: unknown; item: CmsItem }> {
    const current = await this.getStoredSectionData(key);
    const { data, item } = setCmsItemArchived(key, current, itemId, archived);
    const saved = await this.writeSection(key, data);
    return { ...saved, item };
  }

  /** Permanent delete of one archived item. 409 if the item is still live. */
  async deleteArchivedSectionItem(key: string, itemId: string) {
    const current = await this.getStoredSectionData(key);
    return this.writeSection(key, removeArchivedCmsItem(key, current, itemId));
  }

  async saveUploadedFile(file?: UploadedCmsFile): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException('Please choose an image file to upload');
    }

    const ext = ALLOWED_MIME_TYPES[file.mimetype];
    if (!ext) {
      throw new BadRequestException(
        'Only JPEG, PNG, WEBP, GIF, or SVG images are allowed',
      );
    }

    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('Image must be 10MB or smaller');
    }

    const safeName = file.originalname
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const filename = `${Date.now()}-${safeName.endsWith(`.${ext}`) ? safeName : `${safeName}.${ext}`}`;

    return this.mediaService.saveAsset(
      'cms',
      filename,
      file.mimetype,
      file.buffer,
    );
  }

  async subscribeNewsletter(email: string, source = 'Footer Newsletter') {
    const normalized = email.trim().toLowerCase();
    const lead = await this.prisma.newsletterLead.upsert({
      where: { email: normalized },
      create: {
        email: normalized,
        source,
        status: 'Subscribed',
      },
      update: {
        status: 'Subscribed',
        source,
        // Subscribing again is fresh consent, so an archived lead comes back.
        archivedAt: null,
      },
    });

    return {
      ok: true as const,
      message: 'Thanks for subscribing! Look out for our next wellness email.',
      lead,
    };
  }

  /** `archived` = exclude (default) | only | include. */
  async getNewsletterLeads(archived: ArchiveFilter = 'exclude') {
    return this.prisma.newsletterLead.findMany({
      where: archiveWhere(archived),
      orderBy: { subscribedAt: 'desc' },
    });
  }

  private async findNewsletterLeadOrThrow(id: string) {
    const existing = await this.prisma.newsletterLead.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Newsletter lead not found');
    return existing;
  }

  async updateNewsletterLeadStatus(id: string, status: string) {
    await this.findNewsletterLeadOrThrow(id);

    return this.prisma.newsletterLead.update({
      where: { id },
      data: { status },
    });
  }

  // ---- Newsletter lead archive lifecycle (src/common/archive/archive.ts) ----

  async archiveNewsletterLead(id: string) {
    const existing = await this.findNewsletterLeadOrThrow(id);
    if (existing.archivedAt) return existing;
    return this.prisma.newsletterLead.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  async unarchiveNewsletterLead(id: string) {
    const existing = await this.findNewsletterLeadOrThrow(id);
    if (!existing.archivedAt) return existing;
    return this.prisma.newsletterLead.update({
      where: { id },
      data: { archivedAt: null },
    });
  }

  /** Permanent delete. Throws 409 if the lead is not archived. */
  async deleteNewsletterLead(id: string) {
    const existing = await this.findNewsletterLeadOrThrow(id);
    assertArchivedBeforeDelete(existing, `Lead ${existing.email}`);

    await this.prisma.newsletterLead.delete({ where: { id } });
    return { ok: true as const };
  }
}
