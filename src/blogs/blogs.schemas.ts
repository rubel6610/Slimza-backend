import { z } from 'zod';
import { archiveFilterSchema } from '../common/archive/archive.js';

/** URL-safe slug: lowercase letters, numbers and dashes. */
export const blogSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Slug is required')
  .max(150)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug can only contain lowercase letters, numbers and dashes');

export const createBlogSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(300),
  /** Optional: generated from the title when empty. */
  slug: blogSlugSchema.optional().or(z.literal('')),
  excerpt: z.string().trim().min(10, 'Summary must be at least 10 characters').max(1000),
  /** Markdown body. */
  content: z.string().trim().min(20, 'Content must be at least 20 characters').max(200_000),
  image: z.string().trim().min(1, 'Cover image is required').max(1000),
  author: z.string().trim().max(120).optional().default('Slimza'),
  category: z.string().trim().max(100).optional().default(''),
  /** ISO date or date-time. Defaults to now. */
  publishedAt: z.coerce.date().optional(),
});
export type CreateBlogInput = z.infer<typeof createBlogSchema>;

export const updateBlogSchema = createBlogSchema.partial();
export type UpdateBlogInput = z.infer<typeof updateBlogSchema>;

export const blogListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(12),
  /** exclude (default) | only | include, honoured for admins only. */
  archived: archiveFilterSchema,
});
export type BlogListQuery = z.infer<typeof blogListQuerySchema>;

export const blogIdParamSchema = z.string().uuid('Invalid blog id');
export const blogSlugOrIdParamSchema = z.string().trim().min(1).max(200);
