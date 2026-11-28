import { describe, expect, it, vi } from 'vitest';
import { ProductsService } from './products.service.js';

function makeService() {
  const sampleProduct = {
    id: 'prod-1',
    slug: 'slimza-detox-elixir',
    name: 'Slimza Detox Elixir',
    price: 27.99,
    archivedAt: null,
    supplyOptions: [{ label: '1 Month Supply', months: 1, price: 27.99 }],
  };

  const prisma = {
    product: {
      findMany: vi.fn().mockResolvedValue([sampleProduct]),
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn().mockResolvedValue(sampleProduct),
      update: vi.fn().mockResolvedValue({ ...sampleProduct, name: 'Updated Tea' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    cmsSection: {
      findUnique: vi.fn().mockResolvedValue({ data: [] }),
    },
  };

  const mediaService = { saveAsset: vi.fn() };
  const wellnessHub = {
    setProductGroups: vi.fn().mockResolvedValue(undefined),
    removeProducts: vi.fn().mockResolvedValue(undefined),
  };
  const redis = {
    wrap: vi.fn((_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
    delByPrefix: vi.fn().mockResolvedValue(undefined),
  };

  const service = new ProductsService(
    prisma as never,
    mediaService as never,
    wellnessHub as never,
    redis as never,
  );

  return { service, prisma, redis, sampleProduct };
}

describe('ProductsService Redis caching', () => {
  it('caches public findAll, findOne, and search calls, and bypasses cache for admin', async () => {
    const { service, redis } = makeService();

    await service.findAll({ category: 'cleanse-reset' }, false);
    expect(redis.wrap).toHaveBeenCalledWith(
      expect.stringContaining('products:list:'),
      180,
      expect.any(Function),
    );

    await service.findOne('slimza-detox-elixir', false);
    expect(redis.wrap).toHaveBeenCalledWith(
      'products:one:slimza-detox-elixir',
      300,
      expect.any(Function),
    );

    await service.search({ q: '', category: [], brand: [], flag: [], page: 1, limit: 12 });
    expect(redis.wrap).toHaveBeenCalledWith(
      expect.stringContaining('products:search:'),
      120,
      expect.any(Function),
    );

    redis.wrap.mockClear();
    await service.findAll({}, true);
    await service.findOne('prod-1', true);
    expect(redis.wrap).not.toHaveBeenCalled();
  });

  it('invalidates products and wellness-hub caches on update and archive', async () => {
    const { service, redis } = makeService();

    await service.update('prod-1', { name: 'Updated Tea' });
    expect(redis.delByPrefix).toHaveBeenCalledWith('products:');
    expect(redis.delByPrefix).toHaveBeenCalledWith('wellness-hub:');

    redis.delByPrefix.mockClear();
    await service.archive('prod-1');
    expect(redis.delByPrefix).toHaveBeenCalledWith('products:');
    expect(redis.delByPrefix).toHaveBeenCalledWith('wellness-hub:');
  });
});
