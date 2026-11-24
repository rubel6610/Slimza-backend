/**
 * ============================================================================
 *  WELLNESS PRODUCT HUB — managed from Dashboard → Wellness Product Hub
 * ============================================================================
 *
 * Stored as the CMS section `wellness_hub` (GET /cms, PUT /cms/wellness_hub).
 *
 * The homepage "Wellness Product Hub" shows these GROUPS. A group is not a product category:
 * it is a hand-picked, ordered list of products (e.g. "Cleanse & Reset" can hold a tea, a matcha
 * and a shilajit). Shop categories (tea, matcha, shilajit…) are a separate thing (CMS `categories`).
 *
 * Each group has its own page: /wellness-hub/:slug (GET /wellness-hub/:slug).
 * Groups use the normal CMS archive lifecycle (path `groups`, see cms/cms-archive.ts).
 */
import { z } from 'zod';

export const WELLNESS_HUB_CMS_KEY = 'wellness_hub';
export const MAX_GROUP_PRODUCTS = 100;

const text = (max: number) => z.string().trim().max(max);

export const hubGroupSchema = z.object({
  id: z.string().trim().min(1).max(60),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Every group needs a URL name')
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'URL name: lowercase letters, numbers and dashes only'),
  name: text(60).min(1, 'Every group needs a name'),
  description: text(400),
  /** Uploaded image URL ("" = name only) */
  image: text(1000),
  /** Products in the order they are shown. */
  productIds: z.array(z.string().trim().min(1).max(64)).max(MAX_GROUP_PRODUCTS, `A group can hold up to ${MAX_GROUP_PRODUCTS} products`),
  active: z.boolean(),
  archivedAt: z.string().nullable().optional(),
});

export const wellnessHubConfigSchema = z.object({
  enabled: z.boolean(),
  title: text(80).min(1, 'Give the section a title'),
  groups: z.array(hubGroupSchema).max(40),
});

export type HubGroup = z.infer<typeof hubGroupSchema>;
export type WellnessHubConfig = z.infer<typeof wellnessHubConfigSchema>;

export const EMPTY_WELLNESS_HUB: WellnessHubConfig = { enabled: true, title: 'Wellness Product Hub', groups: [] };

export function parseWellnessHubForSave(raw: unknown): { ok: true; data: WellnessHubConfig } | { ok: false; message: string } {
  const parsed = wellnessHubConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `${issue.message}${issue.path.length ? ` (${issue.path.join('.')})` : ''}` };
  }
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const g of parsed.data.groups) {
    if (ids.has(g.id)) return { ok: false, message: `Duplicate group id "${g.id}"` };
    if (slugs.has(g.slug)) return { ok: false, message: `Two groups use the URL name "${g.slug}"` };
    ids.add(g.id);
    slugs.add(g.slug);
  }
  // The same product twice in one group is pointless: keep the first.
  const groups = parsed.data.groups.map((g) => ({ ...g, productIds: [...new Set(g.productIds)] }));
  return { ok: true, data: { ...parsed.data, groups } };
}

/**
 * First version of the hub, built from the shop categories that the homepage used to show:
 * same names, images and order, each holding the products that were in that category.
 */
export function buildHubFromCategories(
  categories: unknown,
  products: Array<{ id: string; category: string; categories: unknown }>,
): WellnessHubConfig {
  const list = Array.isArray(categories) ? categories : [];
  const groups: HubGroup[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    const slug = typeof c.slug === 'string' ? c.slug.trim().toLowerCase() : '';
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || groups.some((g) => g.slug === slug)) continue;
    const inCategory = (p: (typeof products)[number]) =>
      p.category === slug || (Array.isArray(p.categories) && p.categories.includes(slug));
    groups.push({
      id: `hub-${slug}`,
      slug,
      name: String(c.name ?? slug).trim().slice(0, 60) || slug,
      description: '',
      image: typeof c.image === 'string' ? c.image.slice(0, 1000) : '',
      productIds: products.filter(inCategory).map((p) => p.id).slice(0, MAX_GROUP_PRODUCTS),
      active: c.active !== false,
      archivedAt: typeof c.archivedAt === 'string' ? c.archivedAt : null,
    });
  }
  return { ...EMPTY_WELLNESS_HUB, groups };
}

/**
 * Puts a product in exactly these groups (from the product form). Groups it is newly added to get it
 * at the end; groups it stays in keep its position; groups not listed lose it. Unknown ids are ignored.
 */
export function setProductGroups(config: WellnessHubConfig, productId: string, groupIds: string[]): WellnessHubConfig {
  const wanted = new Set(groupIds);
  return {
    ...config,
    groups: config.groups.map((g) => {
      const has = g.productIds.includes(productId);
      if (wanted.has(g.id) && !has && g.productIds.length < MAX_GROUP_PRODUCTS) return { ...g, productIds: [...g.productIds, productId] };
      if (!wanted.has(g.id) && has) return { ...g, productIds: g.productIds.filter((id) => id !== productId) };
      return g;
    }),
  };
}

/** Takes deleted products out of every group. */
export function removeProductsFromHub(config: WellnessHubConfig, productIds: string[]): WellnessHubConfig {
  const gone = new Set(productIds);
  return { ...config, groups: config.groups.map((g) => ({ ...g, productIds: g.productIds.filter((id) => !gone.has(id)) })) };
}
