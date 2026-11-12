import { z } from 'zod';

const normalizedEmail = z.string().trim().toLowerCase().email('Please enter a valid email address');

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name').max(120),
  email: normalizedEmail,
  password: z.string().min(8, 'Use at least 8 characters').max(128),
});

export const verifyCodeSchema = z.object({
  email: normalizedEmail,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Please enter all 6 digits'),
  purpose: z.enum(['signup', 'reset']),
});

export const resendCodeSchema = z.object({
  email: normalizedEmail,
  purpose: z.enum(['signup', 'reset']),
});

export const signInSchema = z.object({
  email: normalizedEmail,
  password: z.string().min(1, 'Please enter your password').max(128),
  remember: z.boolean().optional().default(true),
});

export const forgotPasswordSchema = z.object({
  email: normalizedEmail,
});

export const resetPasswordSchema = z.object({
  email: normalizedEmail,
  password: z.string().min(8, 'Use at least 8 characters').max(128),
  resetToken: z.string().trim().min(1, 'Reset token is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Please enter your current password').max(128),
  newPassword: z.string().min(8, 'Use at least 8 characters').max(128),
});

export const refreshTokenSchema = z
  .object({
    refreshToken: z.string().trim().min(1).optional(),
  })
  .optional();

export type RegisterInput = z.infer<typeof registerSchema>;
export type VerifyCodeInput = z.infer<typeof verifyCodeSchema>;
export type ResendCodeInput = z.infer<typeof resendCodeSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
