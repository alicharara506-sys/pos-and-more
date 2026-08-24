export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendEmailResult {
  delivered: boolean;
  provider: string;
  providerMessageId?: string;
}

/**
 * Typed provider boundary for transactional email (section 1.2: keep
 * external providers behind typed adapter interfaces). Swap the bound
 * implementation in email.module.ts based on EMAIL_PROVIDER — nothing else
 * in the codebase should import a concrete provider SDK directly.
 */
export const EMAIL_ADAPTER = Symbol('EMAIL_ADAPTER');

export interface EmailAdapter {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
