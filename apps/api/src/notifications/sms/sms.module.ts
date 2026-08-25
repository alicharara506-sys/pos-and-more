import { Module } from '@nestjs/common';
import { loadEnv } from '@salesmaster/config';
import { resolveSmsAdapter } from '@salesmaster/notifications';
import { SMS_ADAPTER } from './sms-adapter.interface';

/** Mirrors email.module.ts — binds the DI token via the shared resolver. */
@Module({
  providers: [
    {
      provide: SMS_ADAPTER,
      useFactory: () => resolveSmsAdapter(loadEnv()),
    },
  ],
  exports: [SMS_ADAPTER],
})
export class SmsModule {}
