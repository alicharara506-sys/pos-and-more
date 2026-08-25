export type { EmailAdapter, SendEmailInput, SendEmailResult } from '@salesmaster/notifications';

/**
 * NestJS DI token for the bound `EmailAdapter` — see email.module.ts. The
 * adapter implementations themselves live in `@salesmaster/notifications`
 * so apps/worker can use them too without importing across apps.
 */
export const EMAIL_ADAPTER = Symbol('EMAIL_ADAPTER');
