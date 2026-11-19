/**
 * ============================================================================
 *  ARCHIVE LIFECYCLE (soft delete) — shared rules for every admin resource
 * ============================================================================
 *
 * Nothing in the admin dashboard is deleted in one step. Every deletable
 * thing follows the same three-state lifecycle:
 *
 *      ┌────────┐   archive    ┌──────────┐   delete (permanent)   ┌──────┐
 *      │  LIVE  │ ───────────▶ │ ARCHIVED │ ─────────────────────▶ │ GONE │
 *      └────────┘ ◀─────────── └──────────┘                        └──────┘
 *                   unarchive
 *
 *  - LIVE      `archivedAt = null`. Visible on the storefront and in the
 *              normal admin lists.
 *  - ARCHIVED  `archivedAt = <timestamp>`. Hidden from the storefront and the
 *              normal admin lists; shown only in the "Archived" view. Can be
 *              restored (unarchive) or permanently deleted.
 *  - GONE      Row removed from the database. Cannot be undone.
 *
 * The server enforces this, not just the UI: a DELETE on a live record fails
 * with 409 Conflict (see `assertArchivedBeforeDelete`).
 *
 * Where it applies
 *  - Database records with an `archivedAt` column: Product, Order, Coupon,
 *    NewsletterLead. Endpoints for each resource:
 *        PATCH  /<resource>/:id/archive
 *        PATCH  /<resource>/:id/unarchive
 *        DELETE /<resource>/:id              (archived records only)
 *    List endpoints take `?archived=exclude|only|include` (default `exclude`).
 *  - CMS list items (banner slides, nav links, features, categories, partners,
 *    return-policy cards) live inside JSON sections. They use the same
 *    lifecycle via an `archivedAt` field on each item; see
 *    `src/cms/cms-archive.ts`.
 *
 * Full guide: docs/ARCHIVE.md
 */
import { ConflictException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Which records a list endpoint returns.
 *  - `exclude` (default): live records only
 *  - `only`: archived records only (the dashboard's "Archived" view)
 *  - `include`: everything (e.g. revenue stats that must count archived orders)
 */
export const ARCHIVE_FILTERS = ['exclude', 'only', 'include'] as const;
export type ArchiveFilter = (typeof ARCHIVE_FILTERS)[number];

/** Zod schema for the `?archived=` query param. Defaults to `exclude`. */
export const archiveFilterSchema = z.enum(ARCHIVE_FILTERS).optional().default('exclude');

/** Body for bulk archive / unarchive / delete endpoints. */
export const bulkIdsSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1, 'Select at least one item').max(100),
});
export type BulkIdsInput = z.infer<typeof bulkIdsSchema>;

/**
 * Prisma `where` fragment for an archive filter. Spread it into any `where`:
 *
 *     prisma.product.findMany({ where: { ...archiveWhere(filter), category } })
 */
export function archiveWhere(filter: ArchiveFilter = 'exclude'): {
  archivedAt?: null | { not: null };
} {
  if (filter === 'only') return { archivedAt: { not: null } };
  if (filter === 'include') return {};
  return { archivedAt: null };
}

/**
 * Public endpoints accept `?archived=` too, but only admins may see archived
 * records. Everyone else always gets `exclude`.
 */
export function resolveArchiveFilter(
  requested: ArchiveFilter | undefined,
  isAdmin: boolean,
): ArchiveFilter {
  return isAdmin ? (requested ?? 'exclude') : 'exclude';
}

/**
 * Guard for permanent deletes. Call it before every `prisma.<model>.delete`.
 * Throws 409 Conflict if the record is still live.
 *
 * @param label Human-readable name used in the error, e.g. `Product "Matcha"`.
 */
export function assertArchivedBeforeDelete(
  record: { archivedAt: Date | null },
  label: string,
): void {
  if (!record.archivedAt) {
    throw new ConflictException(
      `${label} is not archived. Archive it first, then delete it permanently from the archive.`,
    );
  }
}

/** Same as `assertArchivedBeforeDelete`, for bulk deletes (all-or-nothing). */
export function assertAllArchivedBeforeDelete(
  records: Array<{ archivedAt: Date | null; label: string }>,
): void {
  const live = records.filter((r) => !r.archivedAt).map((r) => r.label);
  if (live.length > 0) {
    throw new ConflictException(
      `Only archived items can be permanently deleted. Archive these first: ${live.join(', ')}.`,
    );
  }
}
