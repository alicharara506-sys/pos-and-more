import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import {
  createLoggedInUser,
  createTestApp,
  createTestTenant,
  type TestActor,
  type TestTenant,
} from './helpers';

describe('POS sales: idempotency and inventory ledger', () => {
  let app: INestApplication;
  let owner: TestActor;
  let tenant: TestTenant;
  let stockLocationId: string;
  let variantId: string;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await createLoggedInUser(app);
    tenant = await createTestTenant(owner);

    const branches = await owner.agent.get('/api/v1/branches').set('X-Tenant-Id', tenant.tenantId);
    stockLocationId = branches.body[0].stockLocations[0].id;

    const product = await owner.agent
      .post('/api/v1/products')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({
        name: 'Widget',
        variants: [
          {
            sku: `W-${Date.now()}`,
            costPrice: 2,
            retailPrice: 10,
            reorderPoint: 0,
            reorderBuffer: 0,
          },
        ],
      });
    variantId = product.body.variants[0].id;

    await owner.agent
      .post('/api/v1/inventory/adjustments')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({
        stockLocationId,
        variantId,
        quantityDelta: 20,
        type: 'OPENING_BALANCE',
        reason: 'seed',
      });
  });

  afterAll(async () => {
    await app.close();
  });

  it('#11 replaying the same clientMutationId never creates a duplicate sale', async () => {
    const clientMutationId = randomUUID();
    const body = {
      clientMutationId,
      branchId: tenant.branchId,
      stockLocationId,
      lines: [{ variantId, quantity: 2, discountAmount: 0 }],
      payments: [{ method: 'CASH', amount: 20 }],
      currency: 'USD',
    };

    const first = await owner.agent
      .post('/api/v1/sales')
      .set('X-Tenant-Id', tenant.tenantId)
      .send(body);
    expect(first.status).toBe(201);

    const replay = await owner.agent
      .post('/api/v1/sales')
      .set('X-Tenant-Id', tenant.tenantId)
      .send(body);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);

    const list = await owner.agent
      .get('/api/v1/sales')
      .set('X-Tenant-Id', tenant.tenantId)
      .query({ pageSize: 100 });
    const matching = list.body.sales.filter((s: { id: string }) => s.id === first.body.id);
    expect(matching.length).toBe(1);
  });

  it('#13 a refund produces a balanced, traceable inventory movement when restocked', async () => {
    const saleRes = await owner.agent
      .post('/api/v1/sales')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({
        clientMutationId: randomUUID(),
        branchId: tenant.branchId,
        stockLocationId,
        lines: [{ variantId, quantity: 3, discountAmount: 0 }],
        payments: [{ method: 'CASH', amount: 30 }],
        currency: 'USD',
      });
    expect(saleRes.status).toBe(201);

    const beforeMovements = await owner.agent
      .get('/api/v1/inventory/movements')
      .set('X-Tenant-Id', tenant.tenantId)
      .query({ stockLocationId, variantId });
    const balanceBeforeRefund = beforeMovements.body[0].resultingBalance;

    const refundRes = await owner.agent
      .post(`/api/v1/sales/${saleRes.body.id}/refund`)
      .set('X-Tenant-Id', tenant.tenantId)
      .send({ restock: true });
    expect(refundRes.status).toBe(201);

    const afterMovements = await owner.agent
      .get('/api/v1/inventory/movements')
      .set('X-Tenant-Id', tenant.tenantId)
      .query({ stockLocationId, variantId });
    // The most recent movement should be the SALE_RETURN restoring exactly the 3 sold units.
    expect(afterMovements.body[0].type).toBe('SALE_RETURN');
    expect(afterMovements.body[0].quantityDelta).toBe(3);
    expect(afterMovements.body[0].resultingBalance).toBe(balanceBeforeRefund + 3);
  });
});
