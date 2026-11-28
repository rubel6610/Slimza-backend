/**
 * ============================================================================
 *  PRODUCT SEARCH — the storefront's search engine (GET /products/search)
 * ============================================================================
 *
 * Built on MySQL FULLTEXT indexes (see `@@fulltext` on Product in schema.prisma), so a
 * search uses an index instead of scanning every row like `LIKE '%tea%'` does. This is
 * the standard step before a dedicated engine (Meilisearch / Elasticsearch / Algolia);
 * if the catalogue ever outgrows it, only this file needs replacing.
 *
 * How a search string becomes a query ("Detox Teas 2x"):
 *   1. normalise  → lower case, strip operator characters (+ - * " ( ) < > ~ @)
 *   2. tokenise   → ["detox", "teas", "2x"]
 *   3. stem       → "teas" → "tea"  (so "teas" also finds "Tea"; prefix match finds "Teatox")
 *   4. per word   → the product must contain EVERY word, each one in ANY of:
 *                   name (full-text) · description (full-text) · brand · category
 *                   Words shorter than 3 letters ("2x") can't use the full-text index
 *                   (MySQL's minimum token size), so they use a LIKE on the name instead.
 *   5. rank       → by full-text relevance on name + description, then featured order.
 *
 * Every request also returns facet counts (how many products each category / brand /
 * flag would show), worked out in the database, for the filter sidebar.
 */
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import { buildPageMeta, toSkipTake } from '../common/pagination/pagination.js';

export const SEARCH_SORTS = ['relevance', 'default', 'price-asc', 'price-desc', 'rating', 'newest', 'name'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

const csv = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 20) : []));

const money = z.coerce.number().min(0).max(100_000).optional();

/** `GET /products/search?q=&category=a,b&brand=&flag=&min=&max=&sort=&page=&limit=` */
export const productSearchQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  category: csv,
  brand: csv,
  /** Flag slugs, e.g. "best-selling" (products store them as tags). */
  flag: csv,
  min: money,
  max: money,
  /** `relevance` when searching, `default` (featured order) otherwise. */
  sort: z.enum(SEARCH_SORTS).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(60).optional().default(12),
});
export type ProductSearchQuery = z.infer<typeof productSearchQuerySchema>;

// ---- 1–3. Turning text into search terms -----------------------------------------

/** MySQL's default InnoDB full-text minimum token size. */
export const FULLTEXT_MIN_LENGTH = 3;

/**
 * InnoDB's default stopword list. MySQL never indexes these, so "+the*" would match
 * nothing and make the whole search return nothing; they are dropped instead.
 */
export const FULLTEXT_STOPWORDS = new Set([
  'a', 'about', 'an', 'are', 'as', 'at', 'be', 'by', 'com', 'de', 'en', 'for', 'from', 'how', 'i', 'in',
  'is', 'it', 'la', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'what', 'when', 'where', 'who',
  'will', 'with', 'und', 'www', 'and',
]);

/** Very light English stemming: "teas" → "tea", "boxes" → "box", "berries" → "berry". */
export function stem(word: string): string {
  if (word.length <= 3) return word; // "tea", "gas" stay as they are; "teas" → "tea"
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export interface SearchTerms {
  /** Words that can use the full-text index (≥ 3 letters), stemmed. */
  fulltext: string[];
  /** Short words, matched with LIKE on the name. */
  short: string[];
}

/** "Detox  Teas +2x!" → { fulltext: ["detox", "tea"], short: ["2x"] } */
export function parseSearchTerms(q: string): SearchTerms {
  const words = q
    .toLowerCase()
    // Characters with a special meaning in MySQL boolean mode, plus punctuation.
    .replace(/[+\-*"()<>~@,.;:!?/\\|[\]{}]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  const unique = [...new Set(words)].filter((w) => !FULLTEXT_STOPWORDS.has(w));
  return {
    fulltext: [...new Set(unique.filter((w) => w.length >= FULLTEXT_MIN_LENGTH).map(stem))],
    short: unique.filter((w) => w.length < FULLTEXT_MIN_LENGTH),
  };
}

// ---- 4. Filters → Prisma `where` ---------------------------------------------------

/** One `where` per word: the word must appear in name, description, brand or category. */
export function searchTermsWhere(terms: SearchTerms): Prisma.ProductWhereInput[] {
  const fulltext = terms.fulltext.map(
    (word): Prisma.ProductWhereInput => ({
      OR: [
        // `word*` = prefix match in boolean mode: "tea" finds "tea", "teas", "teatox".
        { name: { search: `${word}*` } },
        { description: { search: `${word}*` } },
        { brand: { contains: word } },
        { category: { contains: word } },
      ],
    }),
  );
  const short = terms.short.map((word): Prisma.ProductWhereInput => ({ name: { contains: word } }));
  return [...fulltext, ...short];
}

export const categoryWhere = (slugs: string[]): Prisma.ProductWhereInput =>
  slugs.length ? { OR: slugs.flatMap((slug) => [{ category: slug }, { categories: { array_contains: slug } }]) } : {};

export const brandWhere = (brands: string[]): Prisma.ProductWhereInput => (brands.length ? { brand: { in: brands } } : {});

/** Every selected flag must be present. `tagsBySlug` maps "best-selling" → ["Best Selling", …]. */
export function flagWhere(flags: string[], tagsBySlug: Map<string, string[]>): Prisma.ProductWhereInput[] {
  return flags.map((slug) => {
    const variants = tagsBySlug.get(slug) ?? [slug];
    return { OR: variants.map((tag) => ({ tags: { array_contains: tag } })) };
  });
}

export const priceWhere = (min?: number, max?: number): Prisma.ProductWhereInput =>
  min === undefined && max === undefined ? {} : { price: { ...(min !== undefined ? { gte: min } : {}), ...(max !== undefined ? { lte: max } : {}) } };

/** Only what the public may see. */
export const PUBLIC_PRODUCT_WHERE: Prisma.ProductWhereInput = { archivedAt: null, publishStatus: 'published' };

export const slugifyTag = (tag: string) => tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---- 5. Sorting -------------------------------------------------------------------

export function searchOrderBy(sort: SearchSort, terms: SearchTerms): Prisma.ProductOrderByWithRelationInput[] {
  const stable: Prisma.ProductOrderByWithRelationInput = { id: 'asc' };
  switch (sort) {
    case 'price-asc':
      return [{ price: 'asc' }, stable];
    case 'price-desc':
      return [{ price: 'desc' }, stable];
    case 'rating':
      return [{ rating: 'desc' }, { reviewCount: 'desc' }, stable];
    case 'newest':
      return [{ createdAt: 'desc' }, stable];
    case 'name':
      return [{ name: 'asc' }, stable];
    case 'relevance':
      if (terms.fulltext.length) {
        return [
          { _relevance: { fields: ['name', 'description'], search: terms.fulltext.join(' '), sort: 'desc' } },
          { featuredRank: 'asc' },
          stable,
        ];
      }
      return [{ featuredRank: 'asc' }, stable];
    default:
      return [{ featuredRank: 'asc' }, { createdAt: 'desc' }, stable];
  }
}

export interface SearchFacets {
  categories: Record<string, number>;
  brands: Record<string, number>;
  /** slug → { name (as written on products), count } */
  flags: Record<string, { name: string; count: number }>;
}

export { buildPageMeta, toSkipTake };
