import { z } from 'zod';
import { archiveFilterSchema } from '../common/archive/archive.js';

export const uuidParamSchema = z.string().uuid('Invalid identifier');

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().toLowerCase().email('Please enter a valid email address').optional(),
  phone: z.string().trim().max(40).optional(),
  birthday: z.string().trim().max(30).optional(),
  avatarUrl: z.string().trim().max(500).optional(),
});

export const createAddressSchema = z.object({
  label: z.string().trim().max(50).optional().default('Address'),
  name: z.string().trim().min(1, 'Full name is required').max(120),
  line1: z.string().trim().min(1, 'Address line 1 is required').max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, 'City is required').max(100),
  postcode: z.string().trim().min(1, 'Postcode is required').max(30),
  country: z.string().trim().min(1, 'Country is required').max(100),
  phone: z.string().trim().max(40).optional().default(''),
  isDefault: z.boolean().optional(),
});

export const updateAddressSchema = createAddressSchema.partial();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;

/** Admin user list: `?archived=exclude|only|include&status=ACTIVE|SUSPENDED`. */
export const adminUsersQuerySchema = z.object({
  archived: archiveFilterSchema,
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});
export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;

/** Optional reason, shown to the user when they try to sign in or act. */
export const suspendUserSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type SuspendUserInput = z.infer<typeof suspendUserSchema>;
