import { z } from 'zod';

export const shippingAddressSchema = z.object({
  name: z.string().trim().min(2, 'Please enter recipient name'),
  email: z.string().trim().email('Please enter a valid email address'),
  phone: z.string().trim().min(7, 'Please enter a valid phone number'),
  line1: z.string().trim().min(3, 'Please enter your street address'),
  line2: z.string().trim().optional().default(''),
  city: z.string().trim().min(2, 'Please enter your town or city'),
  /** District / county (optional) */
  district: z.string().trim().max(100).optional().default(''),
  postcode: z.string().trim().min(3, 'Please enter your postcode'),
  country: z.string().trim().min(2, 'Please select a country'),
  deliveryNotes: z.string().trim().optional().default(''),
});
export type ShippingAddressInput = z.infer<typeof shippingAddressSchema>;

export const cartLineInputSchema = z.object({
  productId: z.string().trim(),
  sizeIndex: z.number().int().nonnegative().optional().default(0),
  months: z.number().int().positive().optional().default(1),
  qty: z.number().int().positive().max(50),
  /** Supply option id (products with purchase options) */
  optionId: z.string().trim().max(40).optional(),
  /** One-time purchase (default) or Subscribe & Save */
  purchase: z.enum(['once', 'subscription']).optional().default('once'),
});
/** Input shape: optional fields (purchase, sizeIndex…) may be left out by callers and tests. */
export type CartLineInput = z.input<typeof cartLineInputSchema>;

export const bundleItemInputSchema = z.object({
  productId: z.string().trim(),
  optionId: z.string().trim().optional(),
  qty: z.number().int().positive().max(1000).optional().default(1),
});
export type BundleItemInput = z.infer<typeof bundleItemInputSchema>;

export const cartBundleInputSchema = z.object({
  items: z.array(bundleItemInputSchema),
  qty: z.number().int().positive().max(50),
});
export type CartBundleInput = z.infer<typeof cartBundleInputSchema>;

export const createPaymentIntentSchema = z.object({
  lines: z.array(cartLineInputSchema).optional().default([]),
  bundles: z.array(cartBundleInputSchema).optional().default([]),
  promoCode: z.string().trim().nullable().optional(),
  shippingMethodId: z.string().trim().optional().default('uk-standard'),
  shippingAddress: shippingAddressSchema,
  /** Loyalty points to spend (signed-in customers only). 0 = none. */
  pointsToRedeem: z.number().int().min(0).max(10_000_000).optional().default(0),
  /** Customer agreed to the Subscribe & Save terms (minimum deliveries) — required with subscription lines. */
  acceptSubscriptionTerms: z.boolean().optional().default(false),
  /** Pay with a saved card (Stripe PaymentMethod id). */
  savedCardId: z.string().trim().regex(/^pm_[A-Za-z0-9]+$/).optional(),
  /** Save the new card to the wallet for next time. */
  saveCard: z.boolean().optional().default(false),
});
export type CreatePaymentIntentInput = z.infer<
  typeof createPaymentIntentSchema
>;

export const confirmOrderSchema = z.object({
  paymentIntentId: z.string().trim().nullable().optional(),
  paymentMode: z.enum(['stripe', 'demo']).optional().default('stripe'),
  paymentLabel: z.string().trim().optional().default('Paid securely'),
  lines: z.array(cartLineInputSchema).optional().default([]),
  bundles: z.array(cartBundleInputSchema).optional().default([]),
  promoCode: z.string().trim().nullable().optional(),
  shippingMethodId: z.string().trim().optional().default('uk-standard'),
  shippingAddress: shippingAddressSchema,
  /** Must match what was sent to create-payment-intent. */
  pointsToRedeem: z.number().int().min(0).max(10_000_000).optional().default(0),
  acceptSubscriptionTerms: z.boolean().optional().default(false),
});
export type ConfirmOrderInput = z.infer<typeof confirmOrderSchema>;

export const updateOrderStatusSchema = z.object({
  status: z.enum(['PLACED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

/** Dashboard → order → Tracking (sent to the customer). */
export const orderTrackingSchema = z.object({
  carrier: z.string().trim().min(2, 'Choose the carrier').max(80),
  trackingNumber: z.string().trim().min(3, 'Enter the tracking number').max(80),
  trackingUrl: z.string().trim().url('Use a full link (https://…)').max(500).optional().or(z.literal('')),
  /** Email the customer (default yes) */
  notify: z.boolean().optional().default(true),
});
export type OrderTrackingInput = z.infer<typeof orderTrackingSchema>;

export const requestRefundSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'Please provide a reason for your refund request (at least 5 characters).')
    .max(1000, 'Refund reason must be 1000 characters or less.'),
});
export type RequestRefundInput = z.infer<typeof requestRefundSchema>;

export const processRefundSchema = z.object({
  action: z.enum(['APPROVE_REFUND', 'REJECT']),
  adminNote: z.string().trim().max(500).optional().default(''),
});
export type ProcessRefundInput = z.infer<typeof processRefundSchema>;

export const orderIdParamSchema = z.string().trim().min(1);
