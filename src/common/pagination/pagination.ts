/**
 * ============================================================================
 *  PAGINATION, SEARCH & SORT — one reusable toolkit for every list endpoint
 * ============================================================================
 *
 * Every list endpoint answers the same request:
 *
 *     GET /things?page=2&limit=20&q=tea&sort=createdAt:desc&<filters…>
 *
 * and returns the same response shape:
 *
 *     {
 *       items: [...],                       // just this page
 *       meta: { page: 2, limit: 20, total: 137, totalPages: 7,
 *               hasNextPage: true, hasPreviousPage: true }
 *     }
 *
 * How to use it in a new endpoint (see UsersService.findPage for a real one):
 *
 *   1. Schema   listQuerySchema({ sortable: ['createdAt', 'name'], defaultSort: 'createdAt:desc' })
 *               .extend({ status: z.enum([...]).optional() })      ← your own filters
 *   2. Where    { ...searchWhere(query.q, ['name', 'email']), ...yourFilters }
 *   3. Run      paginate(query, {
 *                 count: () => prisma.thing.count({ where }),
 *                 findMany: (page) => prisma.thing.findMany({ where, orderBy: toOrderBy(query.sort), ...page }),
 *               })
 *
 * Full guide with exercises: docs/PAGINATION.md
 */
import { z } from 'zod';

/** Hard ceiling so nobody can ask for a million rows in one request. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

// ---- 1. Reading the URL ---------------------------------------------------------

/**
 * `?page=` and `?limit=` arrive as strings ("2"), so `z.coerce.number()` turns them into
 * numbers. Bad values (page=-1, limit=5000, page=abc) are rejected with a 400 by the
 * validation pipe, before your code ever runs.
 */
export const pageParamsSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional().default(DEFAULT_PAGE_SIZE),
  /** Free-text search. Empty string = no search. */
  q: z.string().trim().max(200).optional().default(''),
});
export type PageParams = z.infer<typeof pageParamsSchema>;

/**
 * Builds the full query schema for one endpoint: page/limit/q plus a `sort` that only
 * accepts the fields you allow ("name:asc", "createdAt:desc").
 *
 * Why a whitelist? `sort` goes straight into the database query. Allowing any field
 * would let someone sort by `passwordHash` and learn things from the order.
 */
export function listQuerySchema<const F extends string>(options: { sortable: readonly F[]; defaultSort: `${F}:${'asc' | 'desc'}` }) {
  const allowed = new Set<string>(options.sortable);
  return pageParamsSchema.extend({
    sort: z
      .string()
      .trim()
      .optional()
      .default(options.defaultSort)
      .refine(
        (value) => {
          const [field, direction = 'asc'] = value.split(':');
          return allowed.has(field) && (direction === 'asc' || direction === 'desc');
        },
        { message: `sort must be one of ${options.sortable.join(', ')} followed by :asc or :desc` },
      )
      .transform((value) => value as `${F}:${'asc' | 'desc'}`),
  });
}

// ---- 2. page/limit → skip/take ------------------------------------------------------

/**
 * Prisma doesn't know "pages"; it knows "skip N rows, take M rows".
 *   page 1, limit 20 → skip 0,  take 20  (rows 1–20)
 *   page 3, limit 20 → skip 40, take 20  (rows 41–60)
 */
export const toSkipTake = ({ page, limit }: Pick<PageParams, 'page' | 'limit'>) => ({
  skip: (page - 1) * limit,
  take: limit,
});

// ---- 3. search & sort → Prisma `where` / `orderBy` --------------------------------

/**
 * `q` → "any of these fields contains q". Spread it into your `where`:
 *     where: { ...searchWhere(query.q, ['name', 'email']), status: 'ACTIVE' }
 * Returns {} when there is no search, so it is always safe to spread.
 * (MySQL's default collation makes `contains` case-insensitive.)
 */
export function searchWhere<F extends string>(q: string | undefined, fields: readonly F[]) {
  const term = q?.trim();
  if (!term) return {};
  return { OR: fields.map((field) => ({ [field]: { contains: term } })) } as { OR: Array<Record<F, { contains: string }>> };
}

/**
 * "createdAt:desc" → [{ createdAt: 'desc' }, { id: 'desc' }]
 *
 * The extra `id` tiebreaker matters: if 30 rows have the same createdAt, the database may
 * return them in a different order on each request, so a row could appear on page 1 AND
 * page 2. Adding a unique column makes the order stable.
 */
export function toOrderBy<F extends string>(sort: `${F}:${'asc' | 'desc'}`) {
  const [field, direction] = sort.split(':') as [F, 'asc' | 'desc'];
  const order: Array<Record<string, 'asc' | 'desc'>> = [{ [field]: direction }];
  if (field !== 'id') order.push({ id: direction });
  return order;
}

// ---- 4. Run it and shape the response ------------------------------------------

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

export function buildPageMeta(page: number, limit: number, total: number): PageMeta {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
}

/**
 * Runs "how many match?" and "give me this page" at the same time and returns
 * `{ items, meta }`. You pass two small functions, so it works with any Prisma model,
 * any `where`, `select` or `include`, and stays fully typed.
 */
export async function paginate<T>(
  params: Pick<PageParams, 'page' | 'limit'>,
  run: {
    count: () => Promise<number>;
    findMany: (page: { skip: number; take: number }) => Promise<T[]>;
  },
): Promise<Paginated<T>> {
  const [total, items] = await Promise.all([run.count(), run.findMany(toSkipTake(params))]);
  return { items, meta: buildPageMeta(params.page, params.limit, total) };
}
