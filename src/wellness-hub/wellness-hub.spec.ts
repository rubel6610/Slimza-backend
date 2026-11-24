import { describe, expect, it, vi } from 'vitest';
import { buildHubFromCategories, parseWellnessHubForSave } from './wellness-hub-config.js';
import { WellnessHubService } from './wellness-hub.service.js';

const group = (over: Record<string, unknown> = {}) => ({
  id: 'g1', slug: 'cleanse-reset', name: 'Cleanse & Reset', description: '', image: '', productIds: ['p1'], active: true, archivedAt: null, ...over,
});

describe('wellness hub config', () => {
  it('accepts groups with any products and removes duplicates', () => {
    const res = parseWellnessHubForSave({ enabled: true, title: 'Hub', groups: [group({ productIds: ['p1', 'p2', 'p1'] })] });
    expect(res.ok && res.data.groups[0].productIds).toEqual(['p1', 'p2']);
  });

  it('rejects duplicate URL names and bad slugs', () => {
    expect(parseWellnessHubForSave({ enabled: true, title: 'Hub', groups: [group(), group({ id: 'g2' })] }).ok).toBe(false);
    expect(parseWellnessHubForSave({ enabled: true, title: 'Hub', groups: [group({ slug: 'Not ok!' })] }).ok).toBe(false);
    expect(parseWellnessHubForSave({ enabled: true, title: 'Hub', groups: [group({ name: '' })] }).ok).toBe(false);
  });

  it('builds the first hub from the categories, with their products', () => {
    const hub = buildHubFromCategories(
      [
        { id: 'cat-1', slug: 'cleanse-reset', name: 'Cleanse & Reset', image: '/a.png', active: true },
        { id: 'cat-2', slug: 'daily-energy', name: 'Daily Energy', image: '', active: false },
      ],
      [
        { id: 'p1', category: 'cleanse-reset', categories: [] },
        { id: 'p2', category: 'total-wellness', categories: ['total-wellness', 'daily-energy'] },
      ],
    );
    expect(hub.groups.map((g) => [g.slug, g.productIds, g.active, g.image])).toEqual([
      ['cleanse-reset', ['p1'], true, '/a.png'],
      ['daily-energy', ['p2'], false, ''],
    ]);
  });
});

describe('WellnessHubService', () => {
  const stored = { enabled: true, title: 'Hub', groups: [group({ productIds: ['p2', 'p1', 'gone'] }), group({ id: 'g2', slug: 'hidden', active: false })] };
  const make = (record: unknown) => {
    const prisma = {
      cmsSection: { findUnique: vi.fn().mockResolvedValue(record), create: vi.fn() },
      product: { findMany: vi.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]) },
    };
    return { service: new WellnessHubService(prisma as never), prisma };
  };

  it('returns a group page with products in the admin order, skipping unavailable ones', async () => {
    const { service } = make({ data: stored });
    const res = await service.publicGroup('cleanse-reset');
    expect(res.products.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(res.group).toMatchObject({ slug: 'cleanse-reset', name: 'Cleanse & Reset' });
    expect(res.group).not.toHaveProperty('productIds');
  });

  it('404s for hidden or unknown groups', async () => {
    const { service } = make({ data: stored });
    await expect(service.publicGroup('hidden')).rejects.toThrow(/not found/);
    await expect(service.publicGroup('nope')).rejects.toThrow(/not found/);
  });

  it('does not overwrite an existing hub when seeding', async () => {
    const { service, prisma } = make({ key: 'wellness_hub' });
    await service.seedFromCategoriesIfMissing();
    expect(prisma.cmsSection.create).not.toHaveBeenCalled();
  });
});

describe('product ↔ hub groups', () => {
  const hub = {
    enabled: true,
    title: 'Hub',
    groups: [group({ id: 'a', slug: 'a', productIds: ['x', 'p1'] }), group({ id: 'b', slug: 'b', productIds: ['p1', 'y'] }), group({ id: 'c', slug: 'c', productIds: ['z'] })],
  };

  it('puts a product in exactly the chosen groups, keeping existing positions', async () => {
    const { setProductGroups } = await import('./wellness-hub-config.js');
    const next = setProductGroups(hub, 'p1', ['a', 'c', 'unknown']);
    expect(next.groups.map((g) => g.productIds)).toEqual([['x', 'p1'], ['y'], ['z', 'p1']]);
  });

  it('removes deleted products from every group', async () => {
    const { removeProductsFromHub } = await import('./wellness-hub-config.js');
    expect(removeProductsFromHub(hub, ['p1']).groups.map((g) => g.productIds)).toEqual([['x'], ['y'], ['z']]);
  });

  it('saves the change to the stored hub', async () => {
    const prisma = {
      cmsSection: { findUnique: vi.fn().mockResolvedValue({ data: hub }), update: vi.fn() },
    };
    const service = new WellnessHubService(prisma as never);
    await service.setProductGroups('p9', ['b']);
    expect(prisma.cmsSection.update.mock.calls[0][0].data.data.groups[1].productIds).toEqual(['p1', 'y', 'p9']);
    prisma.cmsSection.update.mockClear();
    await service.setProductGroups('p1', ['a', 'b']); // already there → nothing written
    expect(prisma.cmsSection.update).not.toHaveBeenCalled();
  });
});
