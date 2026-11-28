import { z } from 'zod';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isValidIsoDate = (val: string): boolean => {
  if (!ISO_DATE_RE.test(val)) return false;
  const parsed = Date.parse(`${val}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === val;
};

const isoDateString = (fieldName: string) =>
  z
    .string()
    .trim()
    .refine(isValidIsoDate, `${fieldName} must be a valid date in YYYY-MM-DD format`);

export const createCouponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, 'Coupon code is required')
      .max(50, 'Coupon code must be 50 characters or less')
      .transform((val) => val.toUpperCase()),
    discountPercent: z.coerce
      .number()
      .gt(0, 'Discount percentage must be greater than 0')
      .max(100, 'Discount percentage cannot exceed 100'),
    customerRange: z.coerce
      .number()
      .int('Customer range must be a whole number')
      .min(0, 'Customer range must be 0 (unlimited) or greater')
      .optional()
      .default(0),
    generateDate: isoDateString('Start date').optional(),
    expiredDate: isoDateString('Expiry date'),
    isActive: z.boolean().optional().default(true),
  })
  .refine(
    (data) => {
      const start = data.generateDate ?? new Date().toISOString().slice(0, 10);
      return data.expiredDate >= start;
    },
    {
      message: 'Expiry date must be on or after the start date',
      path: ['expiredDate'],
    },
  );

export type CreateCouponInput = z.infer<typeof createCouponSchema>;

export const updateCouponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, 'Coupon code is required')
      .max(50, 'Coupon code must be 50 characters or less')
      .transform((val) => val.toUpperCase())
      .optional(),
    discountPercent: z.coerce
      .number()
      .gt(0, 'Discount percentage must be greater than 0')
      .max(100, 'Discount percentage cannot exceed 100')
      .optional(),
    customerRange: z.coerce
      .number()
      .int('Customer range must be a whole number')
      .min(0, 'Customer range must be 0 (unlimited) or greater')
      .optional(),
    generateDate: isoDateString('Start date').optional(),
    expiredDate: isoDateString('Expiry date').optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.generateDate && data.expiredDate) {
        return data.expiredDate >= data.generateDate;
      }
      return true;
    },
    {
      message: 'Expiry date must be on or after the start date',
      path: ['expiredDate'],
    },
  );

export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;

export const validateCouponSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Please enter a coupon code')
    .transform((val) => val.toUpperCase()),
});

export type ValidateCouponInput = z.infer<typeof validateCouponSchema>;
