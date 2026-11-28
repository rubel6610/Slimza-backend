import { z } from 'zod';

export const updateCmsSectionSchema = z.object({
  data: z.unknown(),
});
export type UpdateCmsSectionInput = z.infer<typeof updateCmsSectionSchema>;

export const subscribeNewsletterSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address'),
  source: z.string().trim().optional().default('Footer Newsletter'),
});
export type SubscribeNewsletterInput = z.infer<typeof subscribeNewsletterSchema>;

export const updateNewsletterLeadSchema = z.object({
  status: z.enum(['Subscribed', 'Unsubscribed']),
});
export type UpdateNewsletterLeadInput = z.infer<typeof updateNewsletterLeadSchema>;

export const cmsKeyParamSchema = z.string().trim().min(1);
export const cmsItemIdParamSchema = z.string().trim().min(1).max(200);

/** `?includeArchived=true` → true; anything else (or missing) → false. */
export const includeArchivedQuerySchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');
export const uuidParamSchema = z.string().uuid('Invalid ID format');
