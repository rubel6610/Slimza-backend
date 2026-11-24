import { z } from 'zod';
import { archiveFilterSchema } from '../common/archive/archive.js';

export const createProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required'),
  slug: z.string().trim().optional(),
  description: z.string().trim().optional().default(''),
  price: z.coerce.number().min(0, 'Price must be 0 or greater'),
  originalPrice: z.coerce.number().optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional().default(0),
  taxIncluded: z.boolean().optional().default(true),
  unlimitedStock: z.boolean().optional().default(false),
  stockQuantity: z.coerce.number().int().min(0).optional().default(50),
  stockStatus: z.enum(['In Stock', 'Low Stock', 'Out of Stock']).optional().default('In Stock'),
  category: z.string().trim().optional().default('cleanse-reset'),
  categories: z.array(z.string()).optional().default([]),
  brand: z.string().trim().optional().default('slimza-teas'),
  tags: z.array(z.string()).optional().default([]),
  publishStatus: z.enum(['published', 'draft']).optional().default('published'),
  featured: z.boolean().optional().default(false),
  featuredRank: z.coerce.number().int().optional().default(99),
  offered: z.boolean().optional().default(false),
  image: z.string().trim().optional().default('/products/tea/teatox-green.png'),
  gallery: z.array(z.string()).optional().default([]),
  sizes: z.unknown().optional(),
  variations: z.unknown().optional(),
  supplyDuration: z.string().trim().optional().default('1 Month'),
  packsPerMonth: z.coerce.number().int().min(1).optional().default(1),
  /** Wellness Product Hub groups this product belongs to (omit to leave them unchanged). */
  hubGroupIds: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const queryProductSchema = z.object({
  q: z.string().trim().optional(),
  category: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  tag: z.string().trim().optional(),
  publishStatus: z.string().trim().optional(),
  featured: z.enum(['true', 'false']).optional(),
  sort: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  /** exclude (default) | only | include — honoured for admins only. */
  archived: archiveFilterSchema,
});
export type QueryProductInput = z.infer<typeof queryProductSchema>;

/** Bulk archive / unarchive / permanent delete all share the same `{ ids }` body. */
export { bulkIdsSchema as bulkProductIdsSchema } from '../common/archive/archive.js';
export type { BulkIdsInput as BulkProductIdsInput } from '../common/archive/archive.js';
