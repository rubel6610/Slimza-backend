import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { BlogsService, readMinutes, slugify } from './blogs.service.js';

const blog = (extra: Record<string, unknown> = {}) => ({
  id: 'b1',
  slug: 'hello',
  title: 'Hello',
  excerpt: 'x',
  content: 'word '.repeat(400),
  image: '/a.png',
  author: 'Slimza',
  category: '',
  publishedAt: new Date(),
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});

function makeService(prismaBlog: Record<string, unknown>) {
  return new BlogsService({ blog: prismaBlog } as unknown as PrismaService);
}

describe('blog helpers', () => {
  it('slugifies titles', () => {
    expect(slugify('Slimza Detox Elixir + Radiance Tea: The Duo!')).toBe('slimza-detox-elixir-radiance-tea-the-duo');
    expect(slugify('Café Crème')).toBe('cafe-creme');
    expect(slugify('!!!')).toBe('post');
  });

  it('estimates read time at ~200 words per minute', () => {
    expect(readMinutes('one two')).toBe(1);
    expect(readMinutes('word '.repeat(600))).toBe(3);
  });
});

describe('BlogsService', () => {
  it('hides archived posts from non-admins', async () => {
    const service = makeService({ findFirst: vi.fn().mockResolvedValue(blog({ archivedAt: new Date() })) });
    await expect(service.findOne('hello', false)).rejects.toThrow(NotFoundException);
    await expect(service.findOne('hello', true)).resolves.toMatchObject({ slug: 'hello', readMinutes: 2 });
  });

  it('generates a unique slug when the title is taken', async () => {
    const findUnique = vi.fn(({ where }: { where: { slug: string } }) =>
      Promise.resolve(where.slug === 'hello' ? { id: 'other' } : null),
    );
    const create = vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(blog(data)));
    const service = makeService({ findUnique, create });
    const created = await service.create({
      title: 'Hello',
      excerpt: 'A short summary',
      content: 'Some content long enough to pass.',
      image: '/a.png',
      author: 'Slimza',
      category: '',
    });
    expect(created.slug).toBe('hello-2');
  });

  it('rejects an explicit slug that another post uses', async () => {
    const service = makeService({ findUnique: vi.fn().mockResolvedValue({ id: 'other' }) });
    await expect(
      service.create({ title: 'X', slug: 'hello', excerpt: 'A short summary', content: 'Long enough content here.', image: '/a.png', author: 'S', category: '' }),
    ).rejects.toThrow(ConflictException);
  });

  it('only deletes archived posts', async () => {
    const del = vi.fn().mockResolvedValue({});
    const live = makeService({ findUnique: vi.fn().mockResolvedValue(blog()), delete: del });
    await expect(live.remove('b1')).rejects.toThrow(ConflictException);
    expect(del).not.toHaveBeenCalled();

    const archived = makeService({ findUnique: vi.fn().mockResolvedValue(blog({ archivedAt: new Date() })), delete: del });
    await expect(archived.remove('b1')).resolves.toEqual({ ok: true });
  });
});
