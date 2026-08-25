export type { SmsAdapter, SendSmsInput, SendSmsResult } from '@salesmaster/notifications';

/** NestJS DI token for the bound `SmsAdapter` — see sms.module.ts. */
export const SMS_ADAPTER = Symbol('SMS_ADAPTER');
