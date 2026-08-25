import type { AppEnv } from '@salesmaster/config';
import { type EmailAdapter, ConsoleEmailAdapter } from './email-adapter';
import { ResendEmailAdapter } from './resend-email-adapter';
import { type SmsAdapter, ConsoleSmsAdapter } from './sms-adapter';
import { TwilioSmsAdapter } from './twilio-sms-adapter';

/**
 * The one place that maps an env-configured provider name to a concrete
 * adapter — every caller (apps/api's NestJS DI, apps/worker's plain
 * instantiation) only ever talks to the `EmailAdapter`/`SmsAdapter`
 * interfaces. Mirrors apps/api/src/integrations/connector-registry.ts's
 * shape for the same reason: adding a provider means adding a case here,
 * never touching a call site.
 */
export function resolveEmailAdapter(env: AppEnv): EmailAdapter {
  switch (env.EMAIL_PROVIDER) {
    case 'console':
      return new ConsoleEmailAdapter();
    case 'resend':
      if (!env.RESEND_API_KEY) {
        throw new Error('EMAIL_PROVIDER=resend requires RESEND_API_KEY to be set.');
      }
      return new ResendEmailAdapter({
        apiKey: env.RESEND_API_KEY,
        fromAddress: env.EMAIL_FROM_ADDRESS,
      });
    case 'sendgrid':
      throw new Error(
        'EMAIL_PROVIDER=sendgrid has no adapter implementation yet — use "resend" or "console".',
      );
    default:
      throw new Error(`Unknown EMAIL_PROVIDER: ${env.EMAIL_PROVIDER satisfies never}`);
  }
}

export function resolveSmsAdapter(env: AppEnv): SmsAdapter {
  switch (env.SMS_PROVIDER) {
    case 'none':
      return new ConsoleSmsAdapter();
    case 'twilio':
      if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
        throw new Error(
          'SMS_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER to be set.',
        );
      }
      return new TwilioSmsAdapter({
        accountSid: env.TWILIO_ACCOUNT_SID,
        authToken: env.TWILIO_AUTH_TOKEN,
        fromNumber: env.TWILIO_FROM_NUMBER,
      });
    default:
      throw new Error(`Unknown SMS_PROVIDER: ${env.SMS_PROVIDER satisfies never}`);
  }
}
