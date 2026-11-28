import { z } from 'zod';
import { archiveFilterSchema } from '../common/archive/archive.js';
import { listQuerySchema, pageParamsSchema } from '../common/pagination/pagination.js';

export const reviewIdParamSchema = z.string().trim().min(1).max(64);
/** Product id or slug */
export const productRefParamSchema = z.string().trim().min(1).max(200);

const rating = z.coerce.number().int().min(1, 'Choose 1 to 5 stars').max(5, 'Choose 1 to 5 stars');

/** A customer writing or editing their own review. */
export const writeReviewSchema = z.object({
  rating,
  title: z.string().trim().max(120).optional().default(''),
  body: z.string().trim().min(10, 'Please write at least 10 characters').max(2000, 'Keep it under 2000 characters'),
});
export type WriteReviewInput = z.infer<typeof writeReviewSchema>;

/** Product page list: newest first by default. */
export const productReviewsQuerySchema = pageParamsSchema.omit({ q: true }).extend({
  limit: z.coerce.number().int().min(1).max(50).optional().default(5),
  sort: z.enum(['newest', 'oldest', 'highest', 'lowest']).optional().default('newest'),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});
export type ProductReviewsQuery = z.infer<typeof productReviewsQuerySchema>;

export const featuredReviewsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).optional().default(12),
});

const flag = z.enum(['true', 'false']).transform((v) => v === 'true').optional();

/** Dashboard list. */
export const adminReviewsQuerySchema = listQuerySchema({ sortable: ['createdAt', 'rating', 'updatedAt'] as const, defaultSort: 'createdAt:desc' }).extend({
  status: z.enum(['PUBLISHED', 'HIDDEN']).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  featured: flag,
  verified: flag,
  replied: flag,
  productId: z.string().trim().max(64).optional(),
  archived: archiveFilterSchema,
});
export type AdminReviewsQuery = z.infer<typeof adminReviewsQuerySchema>;

/** Admin changes (never labelled as edited on the storefront). */
export const adminUpdateReviewSchema = z
  .object({
    status: z.enum(['PUBLISHED', 'HIDDEN']),
    featured: z.boolean(),
    authorName: z.string().trim().min(1).max(60),
    rating,
    title: z.string().trim().max(120),
    body: z.string().trim().min(1).max(2000),
    /** "" removes the reply */
    adminReply: z.string().trim().max(2000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type AdminUpdateReviewInput = z.infer<typeof adminUpdateReviewSchema>;
