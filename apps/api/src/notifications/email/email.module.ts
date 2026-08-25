import { Module } from '@nestjs/common';
import { loadEnv } from '@salesmaster/config';
import { resolveEmailAdapter } from '@salesmaster/notifications';
import { EMAIL_ADAPTER } from './email-adapter.interface';

/**
 * Binds the DI token to whichever adapter `resolveEmailAdapter` selects for
 * the configured EMAIL_PROVIDER (console/resend today; sendgrid throws an
 * honest "not implemented" error rather than silently no-op — see
 * packages/notifications/src/resolve.ts, the one place that mapping lives).
 */
@Module({
  providers: [
    {
      provide: EMAIL_ADAPTER,
      useFactory: () => resolveEmailAdapter(loadEnv()),
    },
  ],
  exports: [EMAIL_ADAPTER],
})
export class EmailModule {}
