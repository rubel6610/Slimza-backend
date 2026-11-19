import { z } from 'zod';
import { archiveFilterSchema } from '../common/archive/archive.js';

const PHONE_RE = /^[+()\d\s.-]{7,25}$/;

/**
 * Public application form (/franchise on the storefront).
 * Field names match the frontend form 1:1 (store/features/franchise/franchiseApi.ts).
 */
export const createFranchiseApplicationSchema = z.object({
  fullName: z.string().trim().min(2, 'Please enter your full name.').max(120),
  email: z.string().trim().toLowerCase().email('Please enter a valid email address.').max(190),
  phone: z.string().trim().regex(PHONE_RE, 'Please enter a valid telephone number.'),
  address: z.string().trim().min(5, 'Please enter your address.').max(500),
  businessName: z.string().trim().max(150).optional().default(''),
  country: z.string().trim().min(2, 'Please enter the country you want to sell in.').max(100),
  location: z.string().trim().min(2, 'Please enter the city or area you want to cover.').max(150),
  interest: z.enum(['FRANCHISE', 'SALES_REPRESENTATIVE'], {
    message: 'Please choose franchise or sales representative.',
  }),
  channel: z.enum(['ONLINE', 'RETAIL', 'BOTH'], {
    message: 'Please choose online, retail or both.',
  }),
  message: z.string().trim().max(2000).optional().default(''),
  /**
   * Spam trap: a hidden input that people never see. Bots fill every field;
   * if this has a value the submission is dropped. Deliberately NOT named like
   * a real field ("website", "company"…), because browsers autofill those even
   * when hidden, which silently dropped real applications.
   */
  _gotcha: z.string().optional().default(''),
});
export type CreateFranchiseApplicationInput = z.infer<typeof createFranchiseApplicationSchema>;

/** Admin list: `?archived=exclude|only|include&status=NEW|CONTACTED|APPROVED|REJECTED`. */
export const franchiseListQuerySchema = z.object({
  archived: archiveFilterSchema,
  status: z.enum(['NEW', 'CONTACTED', 'APPROVED', 'REJECTED']).optional(),
});
export type FranchiseListQuery = z.infer<typeof franchiseListQuerySchema>;

/** Admin review: move through the pipeline and keep an internal note. */
export const updateFranchiseApplicationSchema = z.object({
  status: z.enum(['NEW', 'CONTACTED', 'APPROVED', 'REJECTED']).optional(),
  adminNote: z.string().trim().max(2000).optional(),
});
export type UpdateFranchiseApplicationInput = z.infer<typeof updateFranchiseApplicationSchema>;

export const franchiseIdParamSchema = z.string().uuid('Invalid application id');
