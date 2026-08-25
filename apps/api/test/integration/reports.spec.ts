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

describe('reports: sales-by-period, CSV export, inventory valuation', () => {
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
        name: 'Report Widget',
        variants: [
          {
            sku: `RPT-${Date.now()}`,
            costPrice: 4,
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
      .send({ stockLocationId, variantId, quantityDelta: 50, type: 'OPENING_BALANCE' });

    await owner.agent
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
  });

  afterAll(async () => {
    await app.close();
  });

  it("buckets today's sale into the sales-by-period report with correct totals", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await owner.agent
      .get('/api/v1/reports/sales')
      .set('X-Tenant-Id', tenant.tenantId)
      .query({ from: today, to: today, groupBy: 'day' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].period).toBe(today);
    expect(res.body[0].total).toBe('30.00');
    expect(res.body[0].costOfGoodsSold).toBe('12.00'); // 3 units * $4 cost
    expect(res.body[0].grossProfit).toBe('18.00');
    expect(res.body[0].transactionCount).toBe(1);
  });

  it('zero-fills days with no sales rather than omitting them', async () => {
    const today = new Date();
    const from = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to = today.toISOString().slice(0, 10);
    const res = await owner.agent
      .get('/api/v1/reports/sales')
      .set('X-Tenant-Id', tenant.tenantId)
      .query({ from, to, groupBy: 'day' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(
      res.body.filter((r: { transactionCount: number }) => r.transactionCount === 0),
    ).toHaveLength(2);
  });

  it('exports the same data as a real CSV file', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await owner.agent
      .get('/api/v1/reports/sales/export.csv')
      .set('X-Tenant-Id', tenant.tenantId)
      .query({ from: today, to: today, groupBy: 'day' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe('period,total,cost_of_goods_sold,gross_profit,transaction_count');
    expect(lines[1]).toBe(`${today},30.00,12.00,18.00,1`);
  });

  it('values on-hand inventory at cost', async () => {
    const res = await owner.agent
      .get('/api/v1/reports/inventory-valuation')
      .set('X-Tenant-Id', tenant.tenantId);

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('USD');
    const item = res.body.items.find((i: { variantId: string }) => i.variantId === variantId);
    expect(item).toBeDefined();
    expect(item.quantity).toBe(47); // 50 opening - 3 sold
    expect(item.value).toBe('188.00'); // 47 * $4
  });
});
