import { describe, expect, it } from 'vitest';
import { ConsoleEmailAdapter } from '../email-adapter';
import { ResendEmailAdapter } from '../resend-email-adapter';
import { ConsoleSmsAdapter } from '../sms-adapter';
import { TwilioSmsAdapter } from '../twilio-sms-adapter';
import { resolveEmailAdapter, resolveSmsAdapter } from '../resolve';
import { createFakeFetch, type FakeCall } from './test-fetch';
import type { AppEnv } from '@salesmaster/config';

function baseEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    API_URL: 'http://localhost:4000',
    DATABASE_URL: 'postgresql://x',
    REDIS_URL: 'redis://x',
    AUTH_SESSION_TTL_MINUTES: 43200,
    AUTH_MAGIC_LINK_TTL_MINUTES: 15,
    EMAIL_PROVIDER: 'console',
    EMAIL_FROM_ADDRESS: 'no-reply@example.com',
    SMS_PROVIDER: 'none',
    STORAGE_PROVIDER: 'local',
    AI_PROVIDER: 'none',
    LOG_LEVEL: 'info',
    ...overrides,
  } as AppEnv;
}

describe('ConsoleEmailAdapter', () => {
  it('never claims a real delivery', async () => {
    const result = await new ConsoleEmailAdapter().send({
      to: 'a@b.com',
      subject: 'hi',
      text: 'hello',
    });
    expect(result).toEqual({ delivered: false, provider: 'console' });
  });
});

describe('ConsoleSmsAdapter', () => {
  it('never claims a real delivery', async () => {
    const result = await new ConsoleSmsAdapter().send({ to: '+15550001111', body: 'hi' });
    expect(result).toEqual({ delivered: false, provider: 'none' });
  });
});

describe('ResendEmailAdapter', () => {
  it('POSTs the real Resend API shape and reports a genuine delivery', async () => {
    const calls: FakeCall[] = [];
    const fetchImpl = createFakeFetch(() => ({ body: { id: 'resend-123' } }), calls);
    const adapter = new ResendEmailAdapter({
      apiKey: 'rk_test',
      fromAddress: 'no-reply@example.com',
      fetchImpl,
    });

    const result = await adapter.send({ to: 'customer@example.com', subject: 'Hi', text: 'Body' });

    expect(result).toEqual({
      delivered: true,
      provider: 'resend',
      providerMessageId: 'resend-123',
    });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://api.resend.com/emails');
    expect((call.init?.headers as Record<string, string>).Authorization).toBe('Bearer rk_test');
    const body = JSON.parse(call.init?.body as string);
    expect(body).toMatchObject({ to: ['customer@example.com'], subject: 'Hi' });
  });

  it('throws (never fakes success) on a non-2xx response', async () => {
    const fetchImpl = createFakeFetch(() => ({ status: 401, body: { message: 'bad key' } }));
    const adapter = new ResendEmailAdapter({
      apiKey: 'bad',
      fromAddress: 'no-reply@example.com',
      fetchImpl,
    });
    await expect(adapter.send({ to: 'a@b.com', subject: 'x', text: 'y' })).rejects.toThrow(
      /Resend send failed/,
    );
  });
});

describe('TwilioSmsAdapter', () => {
  it('POSTs the real Twilio Messages API shape with Basic auth', async () => {
    const calls: FakeCall[] = [];
    const fetchImpl = createFakeFetch(() => ({ body: { sid: 'SM123' } }), calls);
    const adapter = new TwilioSmsAdapter({
      accountSid: 'ACxxx',
      authToken: 'secret',
      fromNumber: '+15550009999',
      fetchImpl,
    });

    const result = await adapter.send({ to: '+15550001111', body: 'Your order is ready' });

    expect(result).toEqual({ delivered: true, provider: 'twilio', providerMessageId: 'SM123' });
    const call = calls[0]!;
    expect(call.url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACxxx/Messages.json');
    const expectedAuth = `Basic ${Buffer.from('ACxxx:secret').toString('base64')}`;
    expect((call.init?.headers as Record<string, string>).Authorization).toBe(expectedAuth);
  });
});

describe('resolveEmailAdapter', () => {
  it('returns ConsoleEmailAdapter for the console provider', () => {
    expect(resolveEmailAdapter(baseEnv())).toBeInstanceOf(ConsoleEmailAdapter);
  });

  it('returns ResendEmailAdapter when configured with a key', () => {
    const adapter = resolveEmailAdapter(
      baseEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'rk_test' }),
    );
    expect(adapter).toBeInstanceOf(ResendEmailAdapter);
  });

  it('throws honestly when resend is selected without a key', () => {
    expect(() => resolveEmailAdapter(baseEnv({ EMAIL_PROVIDER: 'resend' }))).toThrow(
      /RESEND_API_KEY/,
    );
  });

  it('throws for the unimplemented sendgrid provider', () => {
    expect(() => resolveEmailAdapter(baseEnv({ EMAIL_PROVIDER: 'sendgrid' }))).toThrow(
      /no adapter implementation/,
    );
  });
});

describe('resolveSmsAdapter', () => {
  it('returns ConsoleSmsAdapter for the none provider', () => {
    expect(resolveSmsAdapter(baseEnv())).toBeInstanceOf(ConsoleSmsAdapter);
  });

  it('returns TwilioSmsAdapter when fully configured', () => {
    const adapter = resolveSmsAdapter(
      baseEnv({
        SMS_PROVIDER: 'twilio',
        TWILIO_ACCOUNT_SID: 'ACxxx',
        TWILIO_AUTH_TOKEN: 'secret',
        TWILIO_FROM_NUMBER: '+15550009999',
      }),
    );
    expect(adapter).toBeInstanceOf(TwilioSmsAdapter);
  });

  it('throws honestly when twilio is selected without full credentials', () => {
    expect(() => resolveSmsAdapter(baseEnv({ SMS_PROVIDER: 'twilio' }))).toThrow(
      /TWILIO_ACCOUNT_SID/,
    );
  });
});
