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
  assertArchivedBeforeDelete,
  type ArchiveFilter,
} from '../common/archive/archive.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  BUNDLE_CMS_KEY,
  DEFAULT_BUNDLE_CONFIG,
  parseBundleConfigForSave,
} from '../bundle/bundle-config.js';
import {
  DEFAULT_LOYALTY_CONFIG,
  LOYALTY_CMS_KEY,
  parseLoyaltyConfigForSave,
} from '../loyalty/loyalty-config.js';
import {
  CURRENCY_CMS_KEY,
  DEFAULT_CURRENCY_CONFIG,
  parseCurrencyConfigForSave,
} from '../currency/currency-config.js';
import {
  DEFAULT_TESTIMONIALS_CONFIG,
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
  resetCmsSectionKeepingCustomItems,
  setCmsItemArchived,
  stripArchivedItems,
  type CmsItem,
} from './cms-archive.js';
import { RedisService } from '../redis/redis.service.js';
import { DEFAULT_SHIPPING_CONFIG, parseShippingConfigForSave, SHIPPING_CMS_KEY } from '../shipping/shipping-config.js';

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

export const DEFAULT_CMS_DATA: Record<string, unknown> = {
  header: {
    showPromoBar: true,
    discountText: 'Up to 50% Off',
    showCountdown: true,
    countdownEndDate: '',
    showPromoCode: true,
    promoCode: 'SLIMZAX2',
    promoTagline: 'Wellness in every bag',
    logoUrl: '/logo.png',
    logoAlt: 'Slimza',
    logoSlogan: 'SMALL Changes BIG Results',
    searchPlaceholder: 'Search natural wellness...',
    showSearch: true,
    showBasket: true,
    showAccount: true,
    navLinks: [
      { id: 'nav-1', label: 'Home', href: '/', active: true },
      { id: 'nav-2', label: 'Shop', href: '/shop', active: true },
      {
        id: 'nav-3',
        label: 'Make Your Own Bundle',
        href: '/bundle',
        active: true,
      },
      { id: 'nav-4', label: 'About Us', href: '/about', active: true },
    ],
  },
  banner_slides: [
    {
      id: 'slide-1',
      slug: 'total-wellness',
      eyebrow: 'NATURAL. EFFECTIVE. SUSTAINABLE.',
      title: ['FUEL YOUR DAY', 'THE NATURAL WAY'],
      description: 'Pure. Nourishing. Effective.',
      cta: 'Shop Now',
      ctaHref: '/shop',
      image: '/banner/banner-image.png',
      alt: 'Slimza Super Greens, Collagen, Slim Fit and Detox pouches with fresh fruit, nuts and herbs',
      mobileFocus: 'object-[64%_center] sm:object-[92%_center]',
      showTextOverlay: true,
      active: true,
    },
    {
      id: 'slide-2',
      slug: 'teatox',
      eyebrow: 'Cleanse & Reset',
      title: ['Start fresh,', 'every day'],
      description:
        'Support your digestion and natural daily energy with our herbal detox blends.',
      cta: 'Shop Teatox',
      ctaHref: '/shop?category=teatox',
      image: '/banner/slides/teatox-banner-slide.jpg',
      alt: 'Teatox detox herbal blends',
      mobileFocus: 'object-right',
      showTextOverlay: true,
      active: true,
    },
    {
      id: 'slide-3',
      slug: 'shilajit',
      eyebrow: 'Pure Vitality',
      title: ['Pure Himalayan', 'Power'],
      description:
        'Harvested at high altitudes for natural stamina, mental clarity, and deep replenishment.',
      cta: 'Explore Shilajit',
      ctaHref: '/shop?category=shilajit',
      image: '/banner/slides/shilajit-banner-slide.jpg',
      alt: 'Pure Himalayan Shilajit resin and capsules',
      mobileFocus: 'object-center',
      active: true,
    },
    {
      id: 'slide-4',
      slug: 'slimming-tea',
      eyebrow: 'Body & Balance',
      title: ['Feel light,', 'stay energized'],
      description:
        'Gentle botanicals formulated to support a balanced metabolism and everyday comfort.',
      cta: 'Discover Slimming',
      ctaHref: '/shop?category=slimming-tea',
      image: '/banner/slides/slimming-tea-banner-slide.jpg',
      alt: 'Natural slimming herbal infusions',
      mobileFocus: 'object-right',
      active: true,
    },
    {
      id: 'slide-5',
      slug: 'matcha',
      eyebrow: 'Focused Calm',
      title: ['Ceremonial grade,', 'pure focus'],
      description:
        'Shade-grown Japanese green tea for clean, sustained morning-to-evening clarity.',
      cta: 'Shop Matcha',
      ctaHref: '/shop?category=matcha',
      image: '/banner/slides/matcha-banner-slide.jpg',
      alt: 'Vibrant ceremonial matcha powder and whisk',
      mobileFocus: 'object-center',
      active: true,
    },
  ],
  bundle: DEFAULT_BUNDLE_CONFIG,
  /** Slimza Rewards settings (Dashboard → Loyalty). See src/loyalty/loyalty-config.ts. */
  loyalty: DEFAULT_LOYALTY_CONFIG,
  /** Display currencies + rates for the header switcher (Dashboard → Currencies). */
  currencies: DEFAULT_CURRENCY_CONFIG,
  /** Homepage "What Our Customers Say" (Dashboard → CMS → Testimonials). */
  testimonials: DEFAULT_TESTIMONIALS_CONFIG,
  /** UK + international shipping, excluded destinations, customs text (Dashboard → Shipping). */
  shipping: DEFAULT_SHIPPING_CONFIG,
  /** Blog categories (Dashboard → Blogs → Categories). Posts reference `slug`. */
  blog_categories: [
    {
      id: 'blogcat-1',
      slug: 'wellness-tips',
      name: 'Wellness Tips',
      archivedAt: null,
    },
    {
      id: 'blogcat-2',
      slug: 'natural-ingredients',
      name: 'Natural Ingredients',
      archivedAt: null,
    },
    { id: 'blogcat-3', slug: 'nutrition', name: 'Nutrition', archivedAt: null },
    { id: 'blogcat-4', slug: 'lifestyle', name: 'Lifestyle', archivedAt: null },
    {
      id: 'blogcat-5',
      slug: 'product-guides',
      name: 'Product Guides',
      archivedAt: null,
    },
    {
      id: 'blogcat-6',
      slug: 'sleep-recovery',
      name: 'Sleep & Recovery',
      archivedAt: null,
    },
  ],
  bundle_banner: {
    imageUrl: '/banner/bundle-reward-banner.png',
    altText: 'Spend £500+ on bundles, get £5 off your order - Bundle Reward',
    href: '/bundle',
    active: true,
  },
  features: [
    {
      id: 'feat-1',
      icon: '/features/1.png',
      title: 'Natural Ingredients',
      active: true,
    },
    {
      id: 'feat-2',
      icon: '/features/2.png',
      title: 'Better Energy',
      active: true,
    },
    {
      id: 'feat-3',
      icon: '/features/3.png',
      title: 'Gut & Immune Support',
      active: true,
    },
    {
      id: 'feat-4',
      icon: '/features/secure-checkout.svg',
      title: 'Secure & Encrypted Checkout',
      active: true,
    },
    {
      id: 'feat-5',
      icon: '/features/5.png',
      title: 'Mental Clarity',
      active: true,
    },
    {
      id: 'feat-6',
      icon: '/features/money-back.svg',
      title: '30-Day Money Back Guarantee',
      active: true,
    },
  ],
  categories: [
    {
      id: 'cat-1',
      slug: 'cleanse-reset',
      name: 'Cleanse & Reset',
      image: '/shop-categories/wellness.jpg',
      active: true,
    },
    {
      id: 'cat-2',
      slug: 'daily-energy',
      name: 'Daily Energy',
      image: '/shop-categories/Functional Coffee.png',
      active: true,
    },
    {
      id: 'cat-3',
      slug: 'peak-performance',
      name: 'Peak Performance',
      image: '/shop-categories/Pure Shilajit Resin.png',
      active: true,
    },
    {
      id: 'cat-4',
      slug: 'radiance-beauty',
      name: 'Radiance & Beauty',
      image: '/shop-categories/sleep.png',
      active: true,
    },
    {
      id: 'cat-5',
      slug: 'total-wellness',
      name: 'Total Wellness',
      image: '/shop-categories/Wellness Supplements.png',
      active: true,
    },
    {
      id: 'cat-6',
      slug: 'restore-renew',
      name: 'Restore & Renew',
      image: '/shop-categories/Ceremonial Matcha.png',
      active: true,
    },
  ],
  trusted_by: {
    title: 'Featured In & Trusted By Retailers Across the UK',
    description:
      'Find Slimza organic teas, ceremonial matcha, and Himalayan shilajit at premium independent grocers, wellness boutiques, and specialty pop-ups nationwide.',
    partners: [
      {
        id: 'partner-1',
        name: 'Spitalfields E1',
        wordmark: 'SPITALFIELDS E1',
        captionAbove: 'Featured at',
        captionBelow: 'London Market',
        active: true,
      },
      {
        id: 'partner-2',
        name: 'Camden Market',
        wordmark: 'CAMDEN MARKET',
        captionAbove: 'Stocked in',
        captionBelow: 'North London',
        active: true,
      },
      {
        id: 'partner-3',
        name: 'Seven Dials Covent Garden',
        wordmark: 'SEVEN DIALS',
        captionAbove: 'Available at',
        captionBelow: 'Covent Garden',
        active: true,
      },
      {
        id: 'partner-4',
        name: 'Borough Market',
        wordmark: 'BOROUGH MARKET',
        captionAbove: 'Selected for',
        captionBelow: 'Artisan Hall',
        active: true,
      },
      {
        id: 'partner-5',
        name: 'Greenwich Market',
        wordmark: 'GREENWICH MARKET',
        captionAbove: 'Showcased at',
        captionBelow: 'Maritime Hall',
        active: true,
      },
    ],
  },
  about_us: {
    eyebrow: 'About us',
    title: 'Premium Health & Wellbeing Products at Slimza',
    lead: 'At Slimza, we believe that living well should feel simple, empowering, and sustainable.',
    paragraphs: [
      'Our mission is to provide premium-quality health and wellbeing products that support healthier lifestyles, increased confidence, and everyday vitality.',
      'Whether you are starting your wellness journey or maintaining a balanced lifestyle, Slimza is here to support you with trusted products you can rely on.',
    ],
    imageUrl: '/slimza-values/products-lifestyle.png',
    imageAlt:
      'Slimza Matcha, Shilajit Resin, Bovine Collagen, Botanical Tea and Detox Tea on a wooden table among leaves',
    journeyTitle: 'Supporting Your Wellness Journey',
    journeyText:
      'Health and wellbeing are ongoing journeys. Slimza helps you make positive lifestyle choices through premium wellness solutions and trusted support.',
    whyUsTitle: 'Why Choose Us',
    whyUsText:
      'We are dedicated to delivering premium quality, purity, and performance in every product we create. From detox teas to shilajit resin, shilajit coffee, and collagen electrolytes, each formula is crafted using carefully sourced ingredients and strict quality standards. Designed for real results, our products elevate your daily wellness routine—helping you feel energised, balanced, and at your best.',
    lists: [
      {
        title: 'Our Commitment to Quality',
        items: [
          'Premium-quality health and wellbeing products',
          'Carefully selected ingredients and formulations',
          'Customer-focused service and support',
          'Dedication to wellness and healthy living',
          'Products designed for modern lifestyles',
        ],
      },
      {
        title: 'Why Choose Slimza?',
        items: [
          'Trusted premium wellness products',
          'Focus on customer satisfaction',
          'Modern approach to health and wellbeing',
          'Reliable service and fast support',
          'Passion for helping customers feel their best',
        ],
      },
    ],
  },
  privacy_policy: {
    title: 'Privacy Policy',
    lastUpdated: 'January 2026',
    content: `## Who we are
This website is operated by Slimza Ltd ("Slimza", "we", "us"). We are the data controller for the personal information we collect about you through slimza.com.
If you have any questions about this policy, email us at info@slimza.com.

## Information we collect
- Contact details — your name, email address, phone number and delivery address
- Order details — the products you buy, payment confirmation (we do not store full card details) and delivery information
- Messages — anything you send us through the contact form or by email
- Technical data — your device, browser and how you use our website, collected through cookies

## How we use your information
- To process and deliver your orders, and to handle returns and refunds
- To reply to your questions and provide customer support
- To send marketing emails, only if you have opted in — you can unsubscribe at any time
- To improve our website, products and services
- To meet our legal and accounting obligations
We rely on the following legal bases under UK GDPR: performing our contract with you, your consent (for marketing), our legitimate interests (improving our service) and legal obligations.

## Who we share it with
We never sell your personal data. We share it only with trusted providers who help us run our business — such as payment processors, delivery companies, website hosting and email services — and only as much as they need to do their job.

## Cookies
We use essential cookies and local storage to make the website work — for example, to remember the items in your basket. With your consent, we may also use analytics cookies to understand how visitors use our site.

## How long we keep it
We keep order records for six years to meet tax and accounting rules. Other information is kept only for as long as we need it for the purposes above.

## Your rights
You have the right to access, correct or delete your personal data, to object to or restrict how we use it, to data portability, and to withdraw consent at any time.
To use any of these rights, email info@slimza.com. If you are unhappy with how we handle your data, you can complain to the Information Commissioner's Office (ico.org.uk).

## Changes to this policy
We may update this policy from time to time.`,
  },
  terms: {
    title: 'Terms and Conditions',
    lastUpdated: 'January 2026',
    content:
      'Welcome to Slimza. By placing an order or using our website, you agree to these terms and conditions.',
  },
  return_policy: {
    heroTitle: 'Return policy',
    eyebrow: 'Shop with confidence',
    title: 'Return & Refund Policy',
    introText:
      'We want our customers to shop with confidence. Please read our returns policy carefully before making a purchase.',
    facts: {
      reportTime: '24 hrs',
      reportLabel: 'to report an issue',
      returnWindow: '30 days',
      returnLabel: 'to return an item',
      conditionValue: 'Unopened',
      conditionLabel: '& unused items only',
    },
    reportingIssue: {
      title: 'Reporting an Issue',
      text: 'If there is an issue with your order, customers must contact us within 24 hours of receiving the item.',
    },
    cards: [
      {
        id: 'card-1',
        icon: 'box',
        title: 'Returns',
        text: 'Items can only be returned within 30 days of receiving your order, and must be sent back in the same condition.',
        items: [
          'The item must be unopened',
          'The item must be unused',
          'The item must be in original condition',
          'Proof of purchase may be required',
        ],
        tone: 'default',
      },
      {
        id: 'card-2',
        icon: 'refund',
        title: 'Refunds',
        text: 'Refunds will only be processed once the returned item has been received and inspected.',
        items: [
          'Item must pass inspection',
          'Must meet return eligibility conditions',
          'Non-compliant items will not be refunded',
        ],
        tone: 'default',
      },
      {
        id: 'card-3',
        icon: 'ban',
        title: 'Non-Refundable Items',
        items: [
          'Opened products',
          'Used products',
          'Damaged or altered items',
          'Late returns (after 30 days)',
        ],
        tone: 'warning',
      },
      {
        id: 'card-4',
        icon: 'truck',
        title: 'Return Shipping',
        text: 'Returns are not free — customers are responsible for return shipping costs, unless the item is incorrect or damaged upon delivery.',
        tone: 'default',
      },
    ],
    address: {
      title: 'Return Address',
      lines: [
        'Slimza Returns',
        'PO BOX 18802',
        'SOLIHULL',
        'B90 9NP',
        'United Kingdom',
      ],
    },
    contact: {
      title: 'Contact Us',
      text: 'If you have any questions regarding returns or refunds, please contact our customer support team before returning any item.',
      buttonText: 'Contact support',
      buttonHref: '/contact',
      supportEmail: 'info@slimza.com',
    },
  },
};

@Injectable()
export class CmsService implements OnModuleInit {
  private readonly logger = new Logger(CmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    await this.ensureCmsUploadsDirectory();
    await this.seedDefaultsIfMissing();
  }

  private async ensureCmsUploadsDirectory() {
    const dir = join(process.cwd(), 'uploads', 'cms');
    await mkdir(dir, { recursive: true });
  }

  async seedDefaultsIfMissing() {
    try {
      const existing = await this.prisma.cmsSection.findMany({
        select: { key: true },
      });
      const existingKeys = new Set(existing.map((e) => e.key));

      for (const [key, defaultVal] of Object.entries(DEFAULT_CMS_DATA)) {
        if (!existingKeys.has(key)) {
          await this.prisma.cmsSection.create({
            data: {
              key,
              data: defaultVal as Prisma.InputJsonValue,
            },
          });
          await this.redis.del('cms:all', `cms:section:${key}`);
          if (key === WELLNESS_HUB_CMS_KEY) {
            await this.redis.delByPrefix('wellness-hub:');
          } else if (key === 'categories') {
            await this.redis.delByPrefix('products:');
          }
          this.logger.log(`Initialized default CMS section for "${key}"`);
        }
      }

      // Upgrade old 1-sentence privacy_policy placeholder to full policy content
      const privacyRec = await this.prisma.cmsSection.findUnique({
        where: { key: 'privacy_policy' },
      });
      if (
        privacyRec &&
        typeof privacyRec.data === 'object' &&
        privacyRec.data !== null &&
        typeof (privacyRec.data as any).content === 'string' &&
        (privacyRec.data as any).content.startsWith(
          'At Slimza, we respect your privacy',
        )
      ) {
        await this.prisma.cmsSection.update({
          where: { key: 'privacy_policy' },
          data: {
            data: DEFAULT_CMS_DATA.privacy_policy as Prisma.InputJsonValue,
          },
        });
        await this.redis.del('cms:all', 'cms:section:privacy_policy');
        this.logger.log(
          'Upgraded privacy_policy in database to full comprehensive content',
        );
      }
    } catch (err) {
      this.logger.warn(`Failed to seed default CMS sections: ${String(err)}`);
    }
  }

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
    const result: Record<string, unknown> = { ...DEFAULT_CMS_DATA };

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

  /** Raw stored data (archived items included), falling back to defaults. */
  private async getStoredSectionData(key: string): Promise<unknown> {
    const record = await this.prisma.cmsSection.findUnique({ where: { key } });
    if (record) return record.data;

    if (key in DEFAULT_CMS_DATA) {
      return DEFAULT_CMS_DATA[key];
    }

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

  /** Restores default content. Custom items are moved to the archive, not deleted. */
  async resetSection(
    key: string,
  ): Promise<{ ok: true; key: string; data: unknown }> {
    if (!(key in DEFAULT_CMS_DATA)) {
      throw new NotFoundException(
        `No default template for CMS section "${key}"`,
      );
    }

    const current = await this.getStoredSectionData(key);
    return this.writeSection(
      key,
      resetCmsSectionKeepingCustomItems(key, current, DEFAULT_CMS_DATA[key]),
    );
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
