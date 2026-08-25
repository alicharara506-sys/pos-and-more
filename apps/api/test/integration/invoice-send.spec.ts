import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import {
  createLoggedInUser,
  createTestApp,
  createTestTenant,
  type TestActor,
  type TestTenant,
} from './helpers';

describe('invoices: on-demand send (email/SMS)', () => {
  let app: INestApplication;
  let owner: TestActor;
  let tenant: TestTenant;
  let invoiceIdWithEmail: string;
  let invoiceIdNoContact: string;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await createLoggedInUser(app);
    tenant = await createTestTenant(owner);

    const customerWithEmail = await owner.agent
      .post('/api/v1/customers')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({ name: 'Has Email', email: 'customer@example.com' });

    const customerNoContact = await owner.agent
      .post('/api/v1/customers')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({ name: 'No Contact Info' });

    async function createInvoice(customerId: string) {
      const res = await owner.agent
        .post('/api/v1/invoices')
        .set('X-Tenant-Id', tenant.tenantId)
        .send({
          branchId: tenant.branchId,
          customerId,
          currency: 'USD',
          lines: [{ description: 'Consulting', quantity: 1, unitPrice: 100 }],
        });
      expect(res.status).toBe(201);
      return res.body.id as string;
    }

    invoiceIdWithEmail = await createInvoice(customerWithEmail.body.id);
    invoiceIdNoContact = await createInvoice(customerNoContact.body.id);
  });

  afterAll(async () => {
    await app.close();
  });

  it("sends via email and reports the adapter's honest delivered flag", async () => {
    const res = await owner.agent
      .post(`/api/v1/invoices/${invoiceIdWithEmail}/send`)
      .set('X-Tenant-Id', tenant.tenantId)
      .send({ channel: 'email' });

    expect(res.status).toBe(201);
    // EMAIL_PROVIDER=console in this environment — never claims a real delivery.
    expect(res.body).toEqual({ delivered: false, provider: 'console' });
  });

  it('rejects sms with 400 when the customer has no phone on file', async () => {
    const res = await owner.agent
      .post(`/api/v1/invoices/${invoiceIdWithEmail}/send`)
      .set('X-Tenant-Id', tenant.tenantId)
      .send({ channel: 'sms' });

    expect(res.status).toBe(400);
  });

  it('rejects email with 400 when the customer has no email on file', async () => {
    const res = await owner.agent
      .post(`/api/v1/invoices/${invoiceIdNoContact}/send`)
      .set('X-Tenant-Id', tenant.tenantId)
      .send({ channel: 'email' });

    expect(res.status).toBe(400);
  });

  it('rejects sending after the public link is revoked', async () => {
    const revoke = await owner.agent
      .post(`/api/v1/invoices/${invoiceIdWithEmail}/revoke-public-link`)
      .set('X-Tenant-Id', tenant.tenantId)
      .send();
    expect(revoke.status).toBe(201);

    const res = await owner.agent
      .post(`/api/v1/invoices/${invoiceIdWithEmail}/send`)
      .set('X-Tenant-Id', tenant.tenantId)
      .send({ channel: 'email' });
    expect(res.status).toBe(400);
  });
});
