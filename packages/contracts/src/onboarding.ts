import { z } from 'zod';

export const createTenantOnboardingSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100).optional(),
  country: z.string().length(2), // ISO 3166-1 alpha-2
  locale: z.string().min(2).max(20).default('en-US'),
  timezone: z.string().min(1).max(100),
  baseCurrency: z.string().length(3).default('USD'), // ISO 4217
  firstBranchName: z.string().trim().min(1).max(200),
  firstBranchAddress: z.string().trim().max(500).optional(),
});
export type CreateTenantOnboardingInput = z.infer<typeof createTenantOnboardingSchema>;

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  roleKey: z.enum(['owner', 'manager', 'cashier', 'inventory_clerk', 'viewer']),
  branchScope: z.array(z.string().uuid()).default([]),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
