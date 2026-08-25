export interface SendSmsInput {
  to: string;
  body: string;
}

export interface SendSmsResult {
  delivered: boolean;
  provider: string;
  providerMessageId?: string;
}

/** Typed provider boundary for SMS — mirrors EmailAdapter (section 1.2). */
export interface SmsAdapter {
  send(input: SendSmsInput): Promise<SendSmsResult>;
}

/**
 * Default adapter when SMS_PROVIDER=none (the .env.example default). Logs
 * instead of sending — an honest `delivered: false`, never a fabricated
 * success.
 */
export class ConsoleSmsAdapter implements SmsAdapter {
  async send(input: SendSmsInput): Promise<SendSmsResult> {
    // eslint-disable-next-line no-console
    console.log(`[console-sms] to=${input.to}\n${input.body}`);
    return { delivered: false, provider: 'none' };
  }
}
