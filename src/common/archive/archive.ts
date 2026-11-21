
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
