import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import {
  createLoggedInUser,
  createTestApp,
  createTestTenant,
  type TestActor,
  type TestTenant,
} from './helpers';

describe('QR code generation', () => {
  let app: INestApplication;
  let owner: TestActor;
  let tenant: TestTenant;
  let variantId: string;
  let sku: string;
  let invoiceId: string;
  let publicToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await createLoggedInUser(app);
    tenant = await createTestTenant(owner);

    sku = `QR-${Date.now()}`;
    const product = await owner.agent
      .post('/api/v1/products')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({
        name: 'QR Widget',
        variants: [{ sku, costPrice: 2, retailPrice: 10, reorderPoint: 0, reorderBuffer: 0 }],
      });
    variantId = product.body.variants[0].id;

    const customer = await owner.agent
      .post('/api/v1/customers')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({ name: 'QR Customer' });
    const invoice = await owner.agent
      .post('/api/v1/invoices')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({
        branchId: tenant.branchId,
        customerId: customer.body.id,
        currency: 'USD',
        lines: [{ description: 'Item', quantity: 1, unitPrice: 10 }],
      });
    invoiceId = invoice.body.id;
    publicToken = invoice.body.publicToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('generates a real, decodable PNG data URL QR code for a product variant SKU', async () => {
    const res = await owner.agent
      .get(`/api/v1/products/variants/${variantId}/qr`)
      .set('X-Tenant-Id', tenant.tenantId);

    expect(res.status).toBe(200);
    expect(res.body.sku).toBe(sku);
    expect(res.body.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('generates a QR code for the invoice public view link', async () => {
    const res = await owner.agent
      .get(`/api/v1/invoices/${invoiceId}/qr`)
      .set('X-Tenant-Id', tenant.tenantId);

    expect(res.status).toBe(200);
    expect(res.body.viewUrl).toContain(`/public/invoices/${publicToken}`);
    expect(res.body.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('404s for a variant that does not belong to this tenant', async () => {
    const other = await createLoggedInUser(app);
    const otherTenant = await createTestTenant(other);

    const res = await other.agent
      .get(`/api/v1/products/variants/${variantId}/qr`)
      .set('X-Tenant-Id', otherTenant.tenantId);

    expect(res.status).toBe(404);
  });
});
