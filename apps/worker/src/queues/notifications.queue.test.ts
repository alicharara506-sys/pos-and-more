import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { EmailAdapter, SendEmailResult } from '@salesmaster/notifications';
import { handleNotification, type NotificationJobData } from './notifications.queue';

const mockPrisma = vi.hoisted(() => ({
  tenant: { findUnique: vi.fn() },
  invitation: { findUnique: vi.fn() },
  invoice: { findUnique: vi.fn() },
  membership: { findMany: vi.fn() },
}));

vi.mock('@salesmaster/database', () => ({ prisma: mockPrisma }));
vi.mock('@salesmaster/config', () => ({ loadEnv: () => ({ APP_URL: 'https://app.example.com' }) }));

function job(data: NotificationJobData): Job<NotificationJobData> {
  return { data } as Job<NotificationJobData>;
}

function fakeEmail(
  result: Partial<SendEmailResult> = {},
): EmailAdapter & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn().mockResolvedValue({ delivered: false, provider: 'console', ...result });
  return { send };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleNotification', () => {
  it('sends a welcome email for tenant.created', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 't1', displayName: 'Acme Co' });
    const email = fakeEmail();

    await handleNotification(
      job({
        outboxEventId: 'e1',
        aggregateType: 'Tenant',
        eventType: 'tenant.created',
        payload: { tenantId: 't1', ownerEmail: 'owner@acme.com' },
      }),
      email,
    );

    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@acme.com',
        subject: expect.stringContaining('Acme Co'),
      }),
    );
  });

  it('sends an invitation email with an accept link', async () => {
    mockPrisma.invitation.findUnique.mockResolvedValue({
      email: 'newuser@example.com',
      token: 'tok123',
      expiresAt: new Date('2030-01-01T00:00:00Z'),
      tenant: { displayName: 'Acme Co' },
    });
    const email = fakeEmail();

    await handleNotification(
      job({
        outboxEventId: 'e2',
        aggregateType: 'Invitation',
        eventType: 'invitation.created',
        payload: { tenantId: 't1', email: 'newuser@example.com', token: 'tok123' },
      }),
      email,
    );

    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'newuser@example.com',
        text: expect.stringContaining('https://app.example.com/accept-invite?token=tok123'),
      }),
    );
  });

  it('emails the customer when an invoice is issued', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv1',
      number: 'INV-0001',
      total: { toString: () => '150.00' },
      currency: 'USD',
      publicToken: 'ptok',
      customer: { email: 'customer@example.com' },
      tenant: { displayName: 'Acme Co' },
    });
    const email = fakeEmail();

    await handleNotification(
      job({
        outboxEventId: 'e3',
        aggregateType: 'Invoice',
        eventType: 'invoice.issued',
        payload: { invoiceId: 'inv1', tenantId: 't1' },
      }),
      email,
    );

    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.com',
        text: expect.stringContaining('https://app.example.com/public/invoices/ptok'),
      }),
    );
  });

  it('skips honestly (does not fake a send) when the invoiced customer has no email', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv1',
      number: 'INV-0001',
      total: { toString: () => '150.00' },
      currency: 'USD',
      publicToken: 'ptok',
      customer: { email: null },
      tenant: { displayName: 'Acme Co' },
    });
    const email = fakeEmail();

    await handleNotification(
      job({
        outboxEventId: 'e3',
        aggregateType: 'Invoice',
        eventType: 'invoice.issued',
        payload: { invoiceId: 'inv1', tenantId: 't1' },
      }),
      email,
    );

    expect(email.send).not.toHaveBeenCalled();
  });

  it('emails every tenant owner on a low-stock alert', async () => {
    mockPrisma.membership.findMany.mockResolvedValue([
      { user: { email: 'owner1@acme.com' } },
      { user: { email: 'owner2@acme.com' } },
    ]);
    const email = fakeEmail();

    await handleNotification(
      job({
        outboxEventId: 'e4',
        aggregateType: 'InventoryBalance',
        eventType: 'inventory.low_stock',
        payload: { tenantId: 't1', productName: 'Widget', sku: 'WID-1', quantity: 2 },
      }),
      email,
    );

    expect(email.send).toHaveBeenCalledTimes(2);
    expect(mockPrisma.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 't1', role: { key: 'owner' } }),
      }),
    );
  });

  it('does not throw for an unhandled event type', async () => {
    const email = fakeEmail();
    await expect(
      handleNotification(
        job({
          outboxEventId: 'e5',
          aggregateType: 'X',
          eventType: 'something.unknown',
          payload: {},
        }),
        email,
      ),
    ).resolves.toBeUndefined();
    expect(email.send).not.toHaveBeenCalled();
  });
});
