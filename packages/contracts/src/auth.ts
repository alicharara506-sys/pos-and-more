import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email();

export const registerWithPasswordSchema = z.object({
  email: emailSchema,
  password: z.string().min(10).max(128),
  name: z.string().trim().min(1).max(200),
});
export type RegisterWithPasswordInput = z.infer<typeof registerWithPasswordSchema>;

export const loginWithPasswordSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginWithPasswordInput = z.infer<typeof loginWithPasswordSchema>;

export const requestMagicLinkSchema = z.object({
  email: emailSchema,
});
export type RequestMagicLinkInput = z.infer<typeof requestMagicLinkSchema>;

export const consumeMagicLinkSchema = z.object({
  token: z.string().min(1),
});
export type ConsumeMagicLinkInput = z.infer<typeof consumeMagicLinkSchema>;

export const oauthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
export type OauthCallbackInput = z.infer<typeof oauthCallbackSchema>;

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(10).max(128),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const verifyMfaSchema = z.object({
  code: z
    .string()
    .length(6)
    .regex(/^\d{6}$/),
});
export type VerifyMfaInput = z.infer<typeof verifyMfaSchema>;

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  email: emailSchema,
  name: z.string().nullable(),
  mfaEnabled: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;
