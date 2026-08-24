import { Module } from '@nestjs/common';
import { loadEnv } from '@salesmaster/config';
import { EMAIL_ADAPTER } from './email-adapter.interface';
import { ConsoleEmailAdapter } from './console-email.adapter';

/**
 * Only a console adapter ships today (EMAIL_PROVIDER=console). SendGrid/Resend
 * adapters are stubbed out in .env.example and docs/integrations.md but not
 * implemented — wiring a real provider here is future work; this module is
 * the only place that would need to change.
 */
@Module({
  providers: [
    {
      provide: EMAIL_ADAPTER,
      useFactory: () => {
        const env = loadEnv();
        if (env.EMAIL_PROVIDER !== 'console') {
          throw new Error(
            `EMAIL_PROVIDER=${env.EMAIL_PROVIDER} has no adapter implementation yet; only "console" ships in this phase.`,
          );
        }
        return new ConsoleEmailAdapter();
      },
    },
  ],
  exports: [EMAIL_ADAPTER],
})
export class EmailModule {}
