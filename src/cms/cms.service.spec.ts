import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { MediaService } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { CmsService } from './cms.service.js';

describe('CmsService', () => {
  let service: CmsService;
  const mockMediaService = {
    saveAsset: vi.fn(),
    getAsset: vi.fn(),
    deleteByUrl: vi.fn(),
  };
  const mockRedisService = {
    wrap: vi.fn((_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
    del: vi.fn().mockResolvedValue(undefined),
    delByPrefix: vi.fn().mockResolvedValue(undefined),
  };
  const mockPrisma = {
    cmsSection: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
    },
    newsletterLead: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CmsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MediaService, useValue: mockMediaService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<CmsService>(CmsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns only the sections stored in the database (no defaults in code)', async () => {
    mockPrisma.cmsSection.findMany.mockResolvedValue([
      { key: 'bundle_banner', data: { imageUrl: '/custom.png', active: true } },
    ]);

    const result = await service.getAllSections();
    expect(result.bundle_banner).toEqual({ imageUrl: '/custom.png', active: true });
    expect(result.header).toBeUndefined();
    expect(mockRedisService.wrap).toHaveBeenCalledWith('cms:all', 300, expect.any(Function));
  });

  it('should bypass redis cache when includeArchived is true', async () => {
    mockPrisma.cmsSection.findMany.mockResolvedValue([]);

    await service.getAllSections(true);
    expect(mockRedisService.wrap).not.toHaveBeenCalled();
  });

  it('should update and upsert a section and invalidate redis cache', async () => {
    mockPrisma.cmsSection.upsert.mockResolvedValue({
      key: 'bundle_banner',
      data: { imageUrl: '/new-bundle.png', active: true },
    });

    const result = await service.updateSection('bundle_banner', { imageUrl: '/new-bundle.png', active: true });
    expect(result).toEqual({
      ok: true,
      key: 'bundle_banner',
      data: { imageUrl: '/new-bundle.png', active: true },
    });
    expect(mockRedisService.del).toHaveBeenCalledWith('cms:all', 'cms:section:bundle_banner');
  });

  it('should subscribe a new newsletter lead', async () => {
    const lead = {
      id: 'l1',
      email: 'subscriber@example.com',
      source: 'Footer Newsletter',
      status: 'Subscribed',
    };
    mockPrisma.newsletterLead.upsert.mockResolvedValue(lead);

    const result = await service.subscribeNewsletter('subscriber@example.com');
    expect(result.ok).toBe(true);
    expect(result.lead).toEqual(lead);
  });
});
