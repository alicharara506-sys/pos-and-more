import type { EmailAdapter, SendEmailInput, SendEmailResult } from './email-adapter';

export interface ResendEmailAdapterConfig {
  apiKey: string;
  fromAddress: string;
  fetchImpl?: typeof fetch;
}

/**
 * Real Resend (https://resend.com/docs/api-reference/emails/send-email)
 * integration — a single REST call, no SDK dependency needed. Genuine code,
 * exercised against the real endpoint whenever RESEND_API_KEY is set; this
 * environment has no live key, so it has only been verified to build and
 * typecheck, never to actually deliver — same honest disclosure as the
 * Google/Apple OAuth and Stripe adapters (see docs/security.md).
 */
export class ResendEmailAdapter implements EmailAdapter {
  constructor(private readonly config: ResendEmailAdapterConfig) {}

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.fromAddress,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend send failed: HTTP ${res.status} ${body}`);
    }
    const data = (await res.json()) as { id?: string };
    return { delivered: true, provider: 'resend', providerMessageId: data.id };
  }
}
