import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma } from '@salesmaster/database';
import {
  createLoggedInUser,
  createTestApp,
  createTestTenant,
  type TestActor,
  type TestTenant,
} from './helpers';

describe('inventory: low-stock alert outbox event', () => {
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
        name: 'Low Stock Widget',
        variants: [
          {
            sku: `LSW-${Date.now()}`,
            costPrice: 2,
            retailPrice: 10,
            reorderPoint: 5,
            reorderBuffer: 0,
          },
        ],
      });
    variantId = product.body.variants[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('publishes inventory.low_stock exactly once when a movement crosses into red status', async () => {
    // Opening balance well above the reorder point (5) — no alert yet.
    await owner.agent
      .post('/api/v1/inventory/adjustments')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({ stockLocationId, variantId, quantityDelta: 10, type: 'OPENING_BALANCE' });

    let events = await prisma.outboxEvent.findMany({
      where: { eventType: 'inventory.low_stock', aggregateId: `${stockLocationId}:${variantId}` },
    });
    expect(events).toHaveLength(0);

    // Drop from 10 to 3 — crosses below the reorder point of 5. Should alert.
    await owner.agent
      .post('/api/v1/inventory/adjustments')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({
        stockLocationId,
        variantId,
        quantityDelta: -7,
        type: 'ADJUSTMENT',
        reason: 'shrinkage',
      });

    events = await prisma.outboxEvent.findMany({
      where: { eventType: 'inventory.low_stock', aggregateId: `${stockLocationId}:${variantId}` },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      tenantId: tenant.tenantId,
      variantId,
      quantity: 3,
    });

    // Another movement while still in the red (3 -> 2) must NOT alert again.
    await owner.agent
      .post('/api/v1/inventory/adjustments')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({
        stockLocationId,
        variantId,
        quantityDelta: -1,
        type: 'ADJUSTMENT',
        reason: 'shrinkage',
      });

    events = await prisma.outboxEvent.findMany({
      where: { eventType: 'inventory.low_stock', aggregateId: `${stockLocationId}:${variantId}` },
    });
    expect(events).toHaveLength(1);

    // Restock above the reorder point, then drop back below it — should alert again (a new crossing).
    await owner.agent
      .post('/api/v1/inventory/adjustments')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({
        stockLocationId,
        variantId,
        quantityDelta: 20,
        type: 'ADJUSTMENT',
        reason: 'restock',
      });
    await owner.agent
      .post('/api/v1/inventory/adjustments')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({
        stockLocationId,
        variantId,
        quantityDelta: -18,
        type: 'ADJUSTMENT',
        reason: 'shrinkage',
      });

    events = await prisma.outboxEvent.findMany({
      where: { eventType: 'inventory.low_stock', aggregateId: `${stockLocationId}:${variantId}` },
    });
    expect(events).toHaveLength(2);
  });
});
