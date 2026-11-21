import { describe, expect, it } from 'vitest';
import {
  flagWhere,
  parseSearchTerms,
  priceWhere,
  productSearchQuerySchema,
  searchOrderBy,
  searchTermsWhere,
  slugifyTag,
  stem,
} from './product-search.js';

describe('parseSearchTerms', () => {
  it('normalises, drops operators and stopwords, and stems', () => {
    expect(parseSearchTerms('  Detox TEAS for the +body* ')).toEqual({ fulltext: ['detox', 'tea', 'body'], short: [] });
  });

  it('keeps short words apart (MySQL ignores words under 3 letters)', () => {
    expect(parseSearchTerms('b12 2x')).toEqual({ fulltext: ['b12'], short: ['2x'] });
  });

  it('returns nothing for an empty or operator-only search', () => {
    expect(parseSearchTerms('')).toEqual({ fulltext: [], short: [] });
    expect(parseSearchTerms('+++ "" ()')).toEqual({ fulltext: [], short: [] });
  });

  it('stems common plurals only', () => {
    expect([stem('teas'), stem('berries'), stem('boxes'), stem('glass'), stem('tea')]).toEqual(['tea', 'berry', 'box', 'glass', 'tea']);
  });
});

describe('query building', () => {
  it('requires every word, each in name, description, brand or category', () => {
    const where = searchTermsWhere({ fulltext: ['tea'], short: ['2x'] });
    expect(where).toEqual([
      {
        OR: [
          { name: { search: 'tea*' } },
          { description: { search: 'tea*' } },
          { brand: { contains: 'tea' } },
          { category: { contains: 'tea' } },
        ],
      },
      { name: { contains: '2x' } },
    ]);
  });

  it('matches flags by any spelling used in product tags', () => {
    const tags = new Map([['best-selling', ['Best Selling', 'best selling']]]);
    expect(flagWhere(['best-selling'], tags)).toEqual([
      { OR: [{ tags: { array_contains: 'Best Selling' } }, { tags: { array_contains: 'best selling' } }] },
    ]);
    expect(slugifyTag('Best Selling!')).toBe('best-selling');
  });

  it('builds price ranges only when given', () => {
    expect(priceWhere()).toEqual({});
    expect(priceWhere(5, 20)).toEqual({ price: { gte: 5, lte: 20 } });
  });

  it('ranks by relevance only when there are full-text words', () => {
    expect(searchOrderBy('relevance', { fulltext: ['tea'], short: [] })[0]).toEqual({
      _relevance: { fields: ['name', 'description'], search: 'tea', sort: 'desc' },
    });
    expect(searchOrderBy('relevance', { fulltext: [], short: [] })[0]).toEqual({ featuredRank: 'asc' });
    expect(searchOrderBy('price-asc', { fulltext: [], short: [] })).toEqual([{ price: 'asc' }, { id: 'asc' }]);
  });

  it('validates the URL', () => {
    expect(productSearchQuerySchema.parse({ category: 'a, b,a', limit: '24' })).toMatchObject({ category: ['a', 'b'], limit: 24, page: 1 });
    expect(productSearchQuerySchema.safeParse({ sort: 'hack' }).success).toBe(false);
    expect(productSearchQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});
