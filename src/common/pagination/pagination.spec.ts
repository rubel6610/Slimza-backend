import { describe, expect, it, vi } from 'vitest';
import { buildPageMeta, listQuerySchema, paginate, searchWhere, toOrderBy, toSkipTake } from './pagination.js';

describe('listQuerySchema (reading the URL)', () => {
  const schema = listQuerySchema({ sortable: ['createdAt', 'name'], defaultSort: 'createdAt:desc' });

  it('fills in defaults and turns strings into numbers', () => {
    expect(schema.parse({})).toEqual({ page: 1, limit: 20, q: '', sort: 'createdAt:desc' });
    expect(schema.parse({ page: '3', limit: '50', q: '  tea ' })).toMatchObject({ page: 3, limit: 50, q: 'tea' });
  });

  it('rejects bad values instead of guessing', () => {
    expect(schema.safeParse({ page: '0' }).success).toBe(false);
    expect(schema.safeParse({ limit: '500' }).success).toBe(false); // above MAX_PAGE_SIZE
    expect(schema.safeParse({ sort: 'passwordHash:asc' }).success).toBe(false); // not whitelisted
    expect(schema.safeParse({ sort: 'name:sideways' }).success).toBe(false);
    expect(schema.parse({ sort: 'name' }).sort).toBe('name'); // direction defaults to asc
  });
});

describe('helpers', () => {
  it('page/limit → skip/take', () => {
    expect(toSkipTake({ page: 1, limit: 20 })).toEqual({ skip: 0, take: 20 });
    expect(toSkipTake({ page: 3, limit: 20 })).toEqual({ skip: 40, take: 20 });
  });

  it('builds a search across fields, or nothing', () => {
    expect(searchWhere('', ['name'])).toEqual({});
    expect(searchWhere('tea', ['name', 'email'])).toEqual({
      OR: [{ name: { contains: 'tea' } }, { email: { contains: 'tea' } }],
    });
  });

  it('sorts with a stable id tiebreaker', () => {
    expect(toOrderBy('name:asc')).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    expect(toOrderBy('id:desc')).toEqual([{ id: 'desc' }]);
  });

  it('works out the page meta', () => {
    expect(buildPageMeta(2, 20, 45)).toEqual({ page: 2, limit: 20, total: 45, totalPages: 3, hasNextPage: true, hasPreviousPage: true });
    expect(buildPageMeta(1, 20, 0)).toMatchObject({ totalPages: 1, hasNextPage: false, hasPreviousPage: false });
  });
});

describe('paginate', () => {
  it('runs count + findMany with the right skip/take and returns { items, meta }', async () => {
    const findMany = vi.fn().mockResolvedValue(['c', 'd']);
    const result = await paginate({ page: 2, limit: 2 }, { count: async () => 5, findMany });
    expect(findMany).toHaveBeenCalledWith({ skip: 2, take: 2 });
    expect(result).toEqual({
      items: ['c', 'd'],
      meta: { page: 2, limit: 2, total: 5, totalPages: 3, hasNextPage: true, hasPreviousPage: true },
    });
  });
});
