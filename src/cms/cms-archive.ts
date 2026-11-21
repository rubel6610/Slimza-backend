/**
 * ============================================================================
 *  CMS ITEM ARCHIVE — the archive lifecycle for items inside CMS sections
 * ============================================================================
 *
 * CMS content is stored as one JSON blob per section (table `CmsSection`).
 * Some sections contain a list of items with an `id` (banner slides, nav links,
 * ...). Those items follow the same lifecycle as database records
 * (src/common/archive/archive.ts), using an `archivedAt` field on the item:
 *
 *     { id: 'feat-1', title: 'Natural', active: true, archivedAt: null }                   // live
 *     { id: 'feat-1', title: 'Natural', active: true, archivedAt: '2026-11-19T10:00:00Z' } // archived
 *
 * `active` and `archivedAt` are independent:
 *  - `active: false` = temporarily hidden by the on/off switch, still in the main list.
 *  - `archivedAt`    = moved to the Archive. Restoring keeps the old `active` value.
 *
 * Rules enforced here (and therefore by the API):
 *  1. `PUT /cms/:key` can edit, add, reorder, archive or restore items, but it
 *     can NEVER remove one. Dropping a live item → 409. Archived items left out
 *     of the payload are kept (so a stale client can't lose them by accident).
 *  2. Permanent removal only happens through `DELETE /cms/:key/items/:itemId`,
 *     and only for archived items.
 *  3. `POST /cms/:key/reset` restores default content. Items you added yourself
 *     are moved to the archive, not deleted.
 *  4. Non-admin readers never receive archived items (`stripArchivedItems`).
 *
 * To make a new section archivable, add it to `CMS_ARCHIVABLE_LISTS` below.
 * Every item in that list needs a unique string `id`.
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export interface CmsArchivableList {
  /** Property holding the list inside the section, or `null` when the section itself is the array. */
  path: string | null;
  /** Singular, human-readable name used in error messages. */
  label: string;
}

/** Section key → where its archivable list lives. */
export const CMS_ARCHIVABLE_LISTS: Record<string, CmsArchivableList> = {
  header: { path: 'navLinks', label: 'Navigation link' },
  banner_slides: { path: null, label: 'Banner slide' },
  features: { path: null, label: 'Feature' },
  categories: { path: null, label: 'Category' },
  trusted_by: { path: 'partners', label: 'Partner' },
  return_policy: { path: 'cards', label: 'Policy card' },
  bundle: { path: 'tiers', label: 'Discount tier' },
  blog_categories: { path: null, label: 'Blog category' },
};

export type CmsItem = Record<string, unknown> & { id?: unknown; archivedAt?: unknown };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isArchivedCmsItem = (item: unknown): boolean =>
  isPlainObject(item) && Boolean(item.archivedAt);

const itemId = (item: unknown): string | null =>
  isPlainObject(item) && typeof item.id === 'string' && item.id ? item.id : null;

/** Best-effort display name for error messages. */
function describeItem(item: CmsItem): string {
  const candidate = item.name ?? item.label ?? item.title ?? item.eyebrow;
  const text = Array.isArray(candidate)
    ? candidate.filter((part) => typeof part === 'string').join(' ')
    : typeof candidate === 'string'
      ? candidate
      : '';
  return `"${text.trim() || (itemId(item) ?? 'item')}"`;
}

export function isArchivableSection(key: string): boolean {
  return key in CMS_ARCHIVABLE_LISTS;
}

function requireArchivableList(key: string): CmsArchivableList {
  const config = CMS_ARCHIVABLE_LISTS[key];
  if (!config) {
    throw new BadRequestException(`CMS section "${key}" has no archivable items.`);
  }
  return config;
}

/** Returns the section's item list, or `null` if the section has none / is malformed. */
export function getCmsItems(key: string, data: unknown): CmsItem[] | null {
  const config = CMS_ARCHIVABLE_LISTS[key];
  if (!config) return null;
  const list = config.path === null ? data : isPlainObject(data) ? data[config.path] : undefined;
  return Array.isArray(list) ? (list as CmsItem[]) : null;
}

/** Returns a copy of `data` with its item list replaced by `items`. */
export function withCmsItems(key: string, data: unknown, items: CmsItem[]): unknown {
  const config = requireArchivableList(key);
  if (config.path === null) return items;
  return { ...(isPlainObject(data) ? data : {}), [config.path]: items };
}

/** Removes archived items. Used for every non-admin read. */
export function stripArchivedItems(key: string, data: unknown): unknown {
  const items = getCmsItems(key, data);
  if (!items) return data;
  return withCmsItems(key, data, items.filter((item) => !isArchivedCmsItem(item)));
}

/**
 * Validates a full-section save (`PUT /cms/:key`) against what is stored.
 *  - Throws 409 if a live item is missing from `incoming` (direct delete).
 *  - Re-appends archived items missing from `incoming` (never lost silently).
 * Returns the data that should be stored.
 */
export function mergeCmsSectionUpdate(key: string, current: unknown, incoming: unknown): unknown {
  const config = CMS_ARCHIVABLE_LISTS[key];
  if (!config) return incoming;

  const currentItems = getCmsItems(key, current) ?? [];
  const incomingItems = getCmsItems(key, incoming);

  // The client didn't send the list at all (e.g. a settings-only save): keep it as is.
  if (!incomingItems) {
    return currentItems.length > 0 ? withCmsItems(key, incoming, currentItems) : incoming;
  }

  const incomingIds = new Set(incomingItems.map(itemId).filter((id): id is string => id !== null));
  const missing = currentItems.filter((item) => {
    const id = itemId(item);
    return id !== null && !incomingIds.has(id);
  });

  const removedLive = missing.filter((item) => !isArchivedCmsItem(item));
  if (removedLive.length > 0) {
    throw new ConflictException(
      `${config.label} ${removedLive.map(describeItem).join(', ')} cannot be deleted directly. ` +
        'Archive it first, then delete it permanently from the archive.',
    );
  }

  return withCmsItems(key, incoming, [...incomingItems, ...missing]);
}

function findItemIndex(key: string, items: CmsItem[], id: string): number {
  const index = items.findIndex((item) => itemId(item) === id);
  if (index === -1) {
    const { label } = requireArchivableList(key);
    throw new NotFoundException(
      `${label} "${id}" was not found in "${key}". If you just added it, save your changes first.`,
    );
  }
  return index;
}

/** Sets or clears `archivedAt` on one item. Idempotent. */
export function setCmsItemArchived(
  key: string,
  data: unknown,
  id: string,
  archived: boolean,
  now: Date = new Date(),
): { data: unknown; item: CmsItem } {
  requireArchivableList(key);
  const items = [...(getCmsItems(key, data) ?? [])];
  const index = findItemIndex(key, items, id);
  const current = items[index];

  const alreadyInState = isArchivedCmsItem(current) === archived;
  const item: CmsItem = alreadyInState
    ? current
    : { ...current, archivedAt: archived ? now.toISOString() : null };
  items[index] = item;

  return { data: withCmsItems(key, data, items), item };
}

/** Permanently removes one archived item. Throws 409 if it is still live. */
export function removeArchivedCmsItem(key: string, data: unknown, id: string): unknown {
  const config = requireArchivableList(key);
  const items = getCmsItems(key, data) ?? [];
  const index = findItemIndex(key, items, id);

  if (!isArchivedCmsItem(items[index])) {
    throw new ConflictException(
      `${config.label} ${describeItem(items[index])} is not archived. ` +
        'Archive it first, then delete it permanently from the archive.',
    );
  }

  return withCmsItems(key, data, items.filter((_, i) => i !== index));
}

/**
 * Reset-to-defaults that never deletes. Returns the default content plus every
 * current item whose id is not in the defaults, moved to the archive.
 */
export function resetCmsSectionKeepingCustomItems(
  key: string,
  current: unknown,
  defaults: unknown,
  now: Date = new Date(),
): unknown {
  if (!isArchivableSection(key)) return defaults;

  const defaultItems = getCmsItems(key, defaults) ?? [];
  const defaultIds = new Set(defaultItems.map(itemId).filter(Boolean));
  const customItems = (getCmsItems(key, current) ?? [])
    .filter((item) => {
      const id = itemId(item);
      return id !== null && !defaultIds.has(id);
    })
    .map((item) => (isArchivedCmsItem(item) ? item : { ...item, archivedAt: now.toISOString() }));

  return withCmsItems(key, defaults, [...defaultItems, ...customItems]);
}
