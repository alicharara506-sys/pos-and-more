import type { SendSmsInput, SendSmsResult, SmsAdapter } from './sms-adapter';

export interface TwilioSmsAdapterConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  fetchImpl?: typeof fetch;
}

/**
 * Real Twilio Programmable Messaging REST API integration
 * (https://www.twilio.com/docs/sms/api/message-resource) — a single
 * Basic-auth form-encoded POST, no SDK dependency needed. Genuine code,
 * exercised against the real endpoint whenever Twilio credentials are set;
 * this environment has none, so it has only been verified to build and
 * typecheck, never to actually deliver — same honest disclosure as the
 * Google/Apple OAuth and Stripe adapters (see docs/security.md).
 */
export class TwilioSmsAdapter implements SmsAdapter {
  constructor(private readonly config: TwilioSmsAdapterConfig) {}

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const basicAuth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString(
      'base64',
    );
    const body = new URLSearchParams({
      To: input.to,
      From: this.config.fromNumber,
      Body: input.body,
    });

    const res = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Twilio send failed: HTTP ${res.status} ${text}`);
    }
    const data = (await res.json()) as { sid?: string };
    return { delivered: true, provider: 'twilio', providerMessageId: data.sid };
  }
}
