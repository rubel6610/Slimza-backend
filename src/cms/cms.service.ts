import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

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
      { id: 'nav-3', label: 'Make Your Own Bundle', href: '/bundle', active: true },
      { id: 'nav-4', label: 'About Us', href: '/about', active: true },
    ],
  },
  banner_slides: [
    {
      id: 'slide-1',
      slug: 'teatox',
      eyebrow: 'Cleanse & Reset',
      title: ['Start fresh,', 'every day'],
      description: 'Support your digestion and natural daily energy with our herbal detox blends.',
      cta: 'Shop Teatox',
      ctaHref: '/shop?category=teatox',
      image: '/banner/slides/teatox-banner-slide.jpg',
      alt: 'Teatox detox herbal blends',
      mobileFocus: 'object-right',
      active: true,
    },
    {
      id: 'slide-2',
      slug: 'shilajit',
      eyebrow: 'Pure Vitality',
      title: ['Pure Himalayan', 'Power'],
      description: 'Harvested at high altitudes for natural stamina, mental clarity, and deep replenishment.',
      cta: 'Explore Shilajit',
      ctaHref: '/shop?category=shilajit',
      image: '/banner/slides/shilajit-banner-slide.jpg',
      alt: 'Pure Himalayan Shilajit resin and capsules',
      mobileFocus: 'object-center',
      active: true,
    },
    {
      id: 'slide-3',
      slug: 'slimming-tea',
      eyebrow: 'Body & Balance',
      title: ['Feel light,', 'stay energized'],
      description: 'Gentle botanicals formulated to support a balanced metabolism and everyday comfort.',
      cta: 'Discover Slimming',
      ctaHref: '/shop?category=slimming-tea',
      image: '/banner/slides/slimming-tea-banner-slide.jpg',
      alt: 'Natural slimming herbal infusions',
      mobileFocus: 'object-right',
      active: true,
    },
    {
      id: 'slide-4',
      slug: 'matcha',
      eyebrow: 'Focused Calm',
      title: ['Ceremonial grade,', 'pure focus'],
      description: 'Shade-grown Japanese green tea for clean, sustained morning-to-evening clarity.',
      cta: 'Shop Matcha',
      ctaHref: '/shop?category=matcha',
      image: '/banner/slides/matcha-banner-slide.jpg',
      alt: 'Vibrant ceremonial matcha powder and whisk',
      mobileFocus: 'object-center',
      active: true,
    },
  ],
  bundle_banner: {
    imageUrl: '/banner/bundle-reward-banner.png',
    altText: 'Spend £500+ on bundles, get £5 off your order - Bundle Reward',
    href: '/bundle',
    active: true,
  },
  features: [
    { id: 'feat-1', icon: '/features/1.png', title: 'Natural Ingredients', active: true },
    { id: 'feat-2', icon: '/features/2.png', title: 'Better Energy', active: true },
    { id: 'feat-3', icon: '/features/3.png', title: 'Gut & Immune Support', active: true },
    { id: 'feat-4', icon: '/features/secure-checkout.svg', title: 'Secure & Encrypted Checkout', active: true },
    { id: 'feat-5', icon: '/features/5.png', title: 'Mental Clarity', active: true },
    { id: 'feat-6', icon: '/features/money-back.svg', title: '30-Day Money Back Guarantee', active: true },
  ],
  trusted_by: {
    title: 'Featured In & Trusted By Retailers Across the UK',
    description: 'Find Slimza organic teas, ceremonial matcha, and Himalayan shilajit at premium independent grocers, wellness boutiques, and specialty pop-ups nationwide.',
    partners: [
      { id: 'partner-1', name: 'Spitalfields E1', wordmark: 'SPITALFIELDS E1', captionAbove: 'Featured at', captionBelow: 'London Market', active: true },
      { id: 'partner-2', name: 'Camden Market', wordmark: 'CAMDEN MARKET', captionAbove: 'Stocked in', captionBelow: 'North London', active: true },
      { id: 'partner-3', name: 'Seven Dials Covent Garden', wordmark: 'SEVEN DIALS', captionAbove: 'Available at', captionBelow: 'Covent Garden', active: true },
      { id: 'partner-4', name: 'Borough Market', wordmark: 'BOROUGH MARKET', captionAbove: 'Selected for', captionBelow: 'Artisan Hall', active: true },
      { id: 'partner-5', name: 'Greenwich Market', wordmark: 'GREENWICH MARKET', captionAbove: 'Showcased at', captionBelow: 'Maritime Hall', active: true },
    ],
  },
  about_us: {
    title: 'About Us',
    subtitle: 'Small changes, big results. Rooted in herbal tradition, refined for modern vitality.',
    mission: 'Our mission is to make pure, natural wellness simple, enjoyable, and genuinely effective.',
    story: 'Founded with a passion for traditional herbalism and clean wellness, Slimza curates the highest-grade botanicals, wild-harvested Himalayan shilajit, and stone-ground ceremonial matcha.',
    highlights: [
      { title: '100% Natural', description: 'Zero artificial additives, preservatives, or synthetic fillers.' },
      { title: 'Ethically Sourced', description: 'Fair partnerships with sustainable smallholder farms and wild-crafters.' },
      { title: 'Third-Party Tested', description: 'Independent lab verified for purity, potency, and safety.' },
    ],
  },
  privacy_policy: {
    title: 'Privacy Policy',
    lastUpdated: 'January 2026',
    content: 'At Slimza, we respect your privacy and are committed to protecting your personal data in accordance with the UK GDPR and Data Protection Act 2018.',
  },
  terms: {
    title: 'Terms and Conditions',
    lastUpdated: 'January 2026',
    content: 'Welcome to Slimza. By placing an order or using our website, you agree to these terms and conditions.',
  },
};

@Injectable()
export class CmsService implements OnModuleInit {
  private readonly logger = new Logger(CmsService.name);

  constructor(private readonly prisma: PrismaService) {}

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
      const existing = await this.prisma.cmsSection.findMany({ select: { key: true } });
      const existingKeys = new Set(existing.map((e) => e.key));

      for (const [key, defaultVal] of Object.entries(DEFAULT_CMS_DATA)) {
        if (!existingKeys.has(key)) {
          await this.prisma.cmsSection.create({
            data: {
              key,
              data: defaultVal as Prisma.InputJsonValue,
            },
          });
          this.logger.log(`Initialized default CMS section for "${key}"`);
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to seed default CMS sections: ${String(err)}`);
    }
  }

  async getAllSections(): Promise<Record<string, unknown>> {
    const records = await this.prisma.cmsSection.findMany();
    const result: Record<string, unknown> = { ...DEFAULT_CMS_DATA };

    for (const record of records) {
      result[record.key] = record.data;
    }

    return result;
  }

  async getSection(key: string): Promise<unknown> {
    const record = await this.prisma.cmsSection.findUnique({ where: { key } });
    if (record) return record.data;

    if (key in DEFAULT_CMS_DATA) {
      return DEFAULT_CMS_DATA[key];
    }

    throw new NotFoundException(`CMS section "${key}" not found`);
  }

  async updateSection(key: string, data: unknown): Promise<{ ok: true; key: string; data: unknown }> {
    const updated = await this.prisma.cmsSection.upsert({
      where: { key },
      create: {
        key,
        data: data as Prisma.InputJsonValue,
      },
      update: {
        data: data as Prisma.InputJsonValue,
      },
    });

    return { ok: true, key: updated.key, data: updated.data };
  }

  async resetSection(key: string): Promise<{ ok: true; key: string; data: unknown }> {
    if (!(key in DEFAULT_CMS_DATA)) {
      throw new NotFoundException(`No default template for CMS section "${key}"`);
    }

    const defaultVal = DEFAULT_CMS_DATA[key];
    return this.updateSection(key, defaultVal);
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

    const cmsDir = join(process.cwd(), 'uploads', 'cms');
    await mkdir(cmsDir, { recursive: true });

    const safeName = file.originalname
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const filename = `${Date.now()}-${safeName.endsWith(`.${ext}`) ? safeName : `${safeName}.${ext}`}`;
    const filePath = join(cmsDir, filename);

    await writeFile(filePath, file.buffer);
    return { url: `/uploads/cms/${filename}` };
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
      },
    });

    return {
      ok: true as const,
      message: 'Thanks for subscribing! Look out for our next wellness email.',
      lead,
    };
  }

  async getNewsletterLeads() {
    return this.prisma.newsletterLead.findMany({
      orderBy: { subscribedAt: 'desc' },
    });
  }

  async updateNewsletterLeadStatus(id: string, status: string) {
    const existing = await this.prisma.newsletterLead.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Newsletter lead not found');

    return this.prisma.newsletterLead.update({
      where: { id },
      data: { status },
    });
  }

  async deleteNewsletterLead(id: string) {
    const existing = await this.prisma.newsletterLead.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Newsletter lead not found');

    await this.prisma.newsletterLead.delete({ where: { id } });
    return { ok: true as const };
  }
}
