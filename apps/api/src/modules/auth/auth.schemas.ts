import { z } from 'zod';
import {
  emailSchema,
  passwordSchema,
  phoneSchema,
  uuidSchema,
} from '../../core/http/validate.js';

export const loginSchema = z.object({
  /** Email or phone — schools frequently issue one but not the other. */
  identifier: z.string().trim().min(3, 'Enter your email or phone number'),
  password: z.string().min(1, 'Password is required'),
  /** Distinguishes token families so "sign out other devices" is meaningful. */
  deviceId: z.string().max(120).optional(),
  rememberMe: z.boolean().optional().default(false),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must differ from the current one',
    path: ['newPassword'],
  });

export const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(3),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

/** Guardian app onboarding: accept an invite and set a password. */
export const acceptInviteSchema = z
  .object({
    token: z.string().min(10),
    otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
    password: passwordSchema,
    confirmPassword: z.string(),
    /** PRD 6.3 requires explicit, recorded consent before any tracking. */
    locationConsent: z.boolean(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const requestOtpSchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(['GUARDIAN_INVITE', 'LOGIN', 'PHONE_VERIFY']),
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  otp: z.string().regex(/^\d{6}$/),
  purpose: z.enum(['GUARDIAN_INVITE', 'LOGIN', 'PHONE_VERIFY']),
});

export const registerPushTokenSchema = z.object({
  token: z.string().min(10).max(512),
  platform: z.enum(['ios', 'android', 'web']),
  deviceName: z.string().max(120).optional(),
});

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  locale: z.string().max(10).optional(),
  avatarUrl: z.string().url().max(500).optional(),
});

export const consentSchema = z.object({
  consentType: z.enum([
    'LOCATION_TRACKING',
    'MARKETING_COMMS',
    'PHOTO_USAGE',
    'DATA_PROCESSING',
  ]),
  granted: z.boolean(),
  version: z.string().max(20).default('1.0'),
});

export const revokeSessionSchema = z.object({
  sessionId: uuidSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
