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
 * external providers behind typed adapter interfaces). Shared between
 * apps/api (NestJS DI, wraps this via a useFactory provider) and apps/worker
 * (plain instantiation — outbox-driven sends happen there, never inside a
 * request-handling DB transaction).
 */
export interface EmailAdapter {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

/**
 * Default adapter when EMAIL_PROVIDER=console (dev/test default — see
 * .env.example). Logs the email instead of sending it. This is an honest
 * "delivered: false to a real inbox" result, never disguised as a real send
 * — callers must not tell a user "email sent" without checking the
 * adapter's `delivered` flag.
 */
export class ConsoleEmailAdapter implements EmailAdapter {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    // eslint-disable-next-line no-console
    console.log(`[console-email] to=${input.to} subject="${input.subject}"\n${input.text}`);
    return { delivered: false, provider: 'console' };
  }
}
