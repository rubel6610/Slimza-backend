import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  archiveWhere,
  assertArchivedBeforeDelete,
  resolveArchiveFilter,
} from '../common/archive/archive.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { BlogListQuery, CreateBlogInput, UpdateBlogInput } from './blogs.schemas.js';

/** "My First Post!" → "my-first-post" */
export const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/, '') || 'post';

/** ~200 words per minute, at least 1. */
export const readMinutes = (markdown: string) =>
  Math.max(1, Math.round(markdown.split(/\s+/).filter(Boolean).length / 200));

/**
 * Blog posts (Dashboard → Blogs). Archive lifecycle:
 *   live ──archive──▶ archived ──delete──▶ gone   (unarchive restores)
 * Archived posts are invisible to the shop (404 / not listed).
 */
@Injectable()
export class BlogsService {
  constructor(private readonly prisma: PrismaService) {}

  private withReadTime<T extends { content: string }>(blog: T) {
    return { ...blog, readMinutes: readMinutes(blog.content) };
  }

  async findAll(query: BlogListQuery, isAdmin: boolean) {
    const archived = resolveArchiveFilter(query.archived, isAdmin);
    const search = query.q?.trim();
    const where: Prisma.BlogWhereInput = {
      ...archiveWhere(archived),
      ...(search
        ? { OR: [{ title: { contains: search } }, { excerpt: { contains: search } }, { author: { contains: search } }] }
        : {}),
    };
    const listWhere: Prisma.BlogWhereInput = query.category ? { ...where, category: query.category } : where;

    const [total, items, grouped] = await Promise.all([
      this.prisma.blog.count({ where: listWhere }),
      this.prisma.blog.findMany({
        where: listWhere,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        // The list never needs the full body; the read time is computed from it below.
        select: {
          id: true, slug: true, title: true, excerpt: true, image: true, author: true,
          category: true, publishedAt: true, archivedAt: true, createdAt: true, updatedAt: true, content: true,
        },
      }),
      // Per-category counts for the category sidebar (same search + archive filter, any category).
      this.prisma.blog.groupBy({ by: ['category'], where, _count: { _all: true } }),
    ]);

    const counts: Record<string, number> = {};
    for (const row of grouped) counts[row.category] = row._count._all;

    return {
      items: items.map(({ content, ...rest }) => ({ ...rest, readMinutes: readMinutes(content) })),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
      counts,
    };
  }

  /** By slug (storefront) or id (dashboard). Archived posts are 404 for non-admins. */
  async findOne(slugOrId: string, isAdmin: boolean) {
    const blog = await this.prisma.blog.findFirst({ where: { OR: [{ slug: slugOrId }, { id: slugOrId }] } });
    if (!blog || (blog.archivedAt && !isAdmin)) throw new NotFoundException('Blog post not found');
    return this.withReadTime(blog);
  }

  private async uniqueSlug(base: string, exceptId?: string) {
    const root = slugify(base);
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? root : `${root}-${i + 1}`;
      const clash = await this.prisma.blog.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!clash || clash.id === exceptId) return candidate;
    }
    return `${root}-${Date.now()}`;
  }

  async create(input: CreateBlogInput) {
    if (input.slug) await this.assertSlugFree(input.slug);
    const slug = input.slug || (await this.uniqueSlug(input.title));
    const blog = await this.prisma.blog.create({
      data: {
        title: input.title,
        slug,
        excerpt: input.excerpt,
        content: input.content,
        image: input.image,
        author: input.author || 'Slimza',
        category: input.category ?? '',
        publishedAt: input.publishedAt ?? new Date(),
      },
    });
    return this.withReadTime(blog);
  }

  async update(id: string, input: UpdateBlogInput) {
    await this.findOrThrow(id);
    if (input.slug) await this.assertSlugFree(input.slug, id);
    const blog = await this.prisma.blog.update({
      where: { id },
      data: {
        ...input,
        slug: input.slug === '' ? undefined : input.slug,
        author: input.author === '' ? 'Slimza' : input.author,
      },
    });
    return this.withReadTime(blog);
  }

  private async assertSlugFree(slug: string, exceptId?: string) {
    const clash = await this.prisma.blog.findUnique({ where: { slug }, select: { id: true } });
    if (clash && clash.id !== exceptId) {
      throw new ConflictException(`Another blog post already uses the link "/blogs/${slug}". Choose a different slug.`);
    }
  }

  private async findOrThrow(id: string) {
    const blog = await this.prisma.blog.findUnique({ where: { id } });
    if (!blog) throw new NotFoundException('Blog post not found');
    return blog;
  }

  async archive(id: string) {
    const blog = await this.findOrThrow(id);
    if (blog.archivedAt) return this.withReadTime(blog);
    return this.withReadTime(await this.prisma.blog.update({ where: { id }, data: { archivedAt: new Date() } }));
  }

  async unarchive(id: string) {
    await this.findOrThrow(id);
    return this.withReadTime(await this.prisma.blog.update({ where: { id }, data: { archivedAt: null } }));
  }

  /** Permanent. The post must be archived first (409 otherwise). */
  async remove(id: string) {
    const blog = await this.findOrThrow(id);
    assertArchivedBeforeDelete(blog, `Blog post "${blog.title}"`);
    await this.prisma.blog.delete({ where: { id } });
    return { ok: true as const };
  }
}
