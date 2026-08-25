import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import {
  createLoggedInUser,
  createTestApp,
  createTestTenant,
  type TestActor,
  type TestTenant,
} from './helpers';

/**
 * Acceptance test #12: "Tenant A cannot access Tenant B data by changing
 * IDs, query parameters, exports, background-job payloads, or websocket
 * subscriptions." This covers the REST surface.
 */
describe('tenant isolation', () => {
  let app: INestApplication;
  let ownerA: TestActor;
  let ownerB: TestActor;
  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let productAId: string;
  let productAVariantId: string;

  beforeAll(async () => {
    app = await createTestApp();
    ownerA = await createLoggedInUser(app);
    ownerB = await createLoggedInUser(app);
    tenantA = await createTestTenant(ownerA);
    tenantB = await createTestTenant(ownerB);

    const productRes = await ownerA.agent
      .post('/api/v1/products')
      .set('X-Tenant-Id', tenantA.tenantId)
      .send({
        name: 'Tenant A Secret Product',
        variants: [
          {
            sku: `A-${Date.now()}`,
            costPrice: 1,
            retailPrice: 2,
            reorderPoint: 0,
            reorderBuffer: 0,
          },
        ],
      });
    expect(productRes.status).toBe(201);
    productAId = productRes.body.id;
    productAVariantId = productRes.body.variants[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects a user acting as a tenant they don't belong to", async () => {
    const res = await ownerB.agent.get('/api/v1/products').set('X-Tenant-Id', tenantA.tenantId);
    expect(res.status).toBe(403);
  });

  it("does not leak tenant A's product to tenant B even by direct ID", async () => {
    const res = await ownerB.agent
      .get(`/api/v1/products/${productAId}`)
      .set('X-Tenant-Id', tenantB.tenantId);
    expect(res.status).toBe(404);
  });

  it("tenant B's product list never contains tenant A's product", async () => {
    const res = await ownerB.agent.get('/api/v1/products').set('X-Tenant-Id', tenantB.tenantId);
    expect(res.status).toBe(200);
    const ids = res.body.products.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(productAId);
  });

  it('rejects a request with no X-Tenant-Id header', async () => {
    const res = await ownerA.agent.get('/api/v1/products');
    expect(res.status).toBe(403);
  });

  it('tenant A owner can still access their own product', async () => {
    const res = await ownerA.agent
      .get(`/api/v1/products/${productAId}`)
      .set('X-Tenant-Id', tenantA.tenantId);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(productAId);
  });

  it("rejects an inventory adjustment naming tenant A's variant against tenant B's own stock location", async () => {
    const branches = await ownerB.agent
      .get('/api/v1/branches')
      .set('X-Tenant-Id', tenantB.tenantId);
    const stockLocationId = branches.body[0].stockLocations[0].id;

    const res = await ownerB.agent
      .post('/api/v1/inventory/adjustments')
      .set('X-Tenant-Id', tenantB.tenantId)
      .send({
        stockLocationId,
        variantId: productAVariantId,
        quantityDelta: 10,
        type: 'OPENING_BALANCE',
      });

    expect(res.status).toBe(404);
  });

  it("rejects a stock transfer naming tenant A's variant even between tenant B's own stock locations", async () => {
    const beforeBranches = await ownerB.agent
      .get('/api/v1/branches')
      .set('X-Tenant-Id', tenantB.tenantId);
    const fromLocationId = beforeBranches.body[0].stockLocations[0].id;

    await ownerB.agent
      .post('/api/v1/branches')
      .set('X-Tenant-Id', tenantB.tenantId)
      .send({ name: 'Second Branch', timezone: 'UTC', currency: 'USD' });
    const afterBranches = await ownerB.agent
      .get('/api/v1/branches')
      .set('X-Tenant-Id', tenantB.tenantId);
    const toLocationId = afterBranches.body.find(
      (b: { id: string }) => b.stockLocations[0].id !== fromLocationId,
    ).stockLocations[0].id;

    const res = await ownerB.agent
      .post('/api/v1/inventory/transfers')
      .set('X-Tenant-Id', tenantB.tenantId)
      .send({
        fromStockLocationId: fromLocationId,
        toStockLocationId: toLocationId,
        lines: [{ variantId: productAVariantId, quantity: 1 }],
      });

    expect(res.status).toBe(404);
  });
});
