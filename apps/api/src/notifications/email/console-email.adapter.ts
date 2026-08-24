import { Injectable, Logger } from '@nestjs/common';
import type { EmailAdapter, SendEmailInput, SendEmailResult } from './email-adapter.interface';

/**
 * Default adapter when EMAIL_PROVIDER=console (dev/test default — see
 * .env.example). Logs the email instead of sending it. This is an honest
 * "delivered: false to a real inbox" result, never disguised as a real send
 * — apps/web must not tell a user "email sent" without checking the
 * adapter's provider name against a real provider.
 */
@Injectable()
export class ConsoleEmailAdapter implements EmailAdapter {
  private readonly logger = new Logger('ConsoleEmailAdapter');

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    this.logger.log(`[console-email] to=${input.to} subject="${input.subject}"\n${input.text}`);
    return { delivered: false, provider: 'console' };
  }
}
