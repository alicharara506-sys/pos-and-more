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

describe('billing acceptance tests (spec §21)', () => {
  let app: INestApplication;
  let owner: TestActor;
  let tenant: TestTenant;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await createLoggedInUser(app);
    tenant = await createTestTenant(owner);
  });

  afterAll(async () => {
    await app.close();
  });

  it('#1 charges exactly $10/month for one branch and one owner user', async () => {
    const res = await owner.agent
      .post('/api/v1/billing/preview')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.totalUsd).toBe('10.00');
    expect(res.body.activeBranchCount).toBe(1);
    expect(res.body.billableUserCount).toBe(1);
  });

  it('#2 activating a second branch changes the monthly subtotal by exactly $5', async () => {
    const before = await owner.agent
      .post('/api/v1/billing/preview')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({});

    const branchRes = await owner.agent
      .post('/api/v1/branches')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({ name: 'Second Branch', timezone: 'UTC', currency: 'USD' });
    expect(branchRes.status).toBe(201);

    const after = await owner.agent
      .post('/api/v1/billing/preview')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({});
    expect(after.body.totalUsdCents - before.body.totalUsdCents).toBe(500);
    expect(after.body.totalUsd).toBe('15.00');
  });

  it('#3 activating one additional billable user changes the monthly subtotal by exactly $2', async () => {
    const before = await owner.agent
      .post('/api/v1/billing/preview')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({});

    const newUser = await createLoggedInUser(app);
    const inviteRes = await owner.agent
      .post('/api/v1/onboarding/invite')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({ email: newUser.email, roleKey: 'cashier', branchScope: [] });
    expect(inviteRes.status).toBe(201);

    // The invite token is only ever delivered by email in production; read
    // it straight from the DB here rather than exposing it over the API.
    const invitation = await prisma.invitation.findFirstOrThrow({
      where: { id: inviteRes.body.id },
    });

    const acceptRes = await newUser.agent.post(
      `/api/v1/onboarding/invite/${invitation.token}/accept`,
    );
    expect(acceptRes.status).toBe(201);

    const after = await owner.agent
      .post('/api/v1/billing/preview')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({});
    expect(after.body.billableUserCount - before.body.billableUserCount).toBe(1);
    expect(after.body.totalUsdCents - before.body.totalUsdCents).toBe(200);
  });

  it('#4 concurrent branch creation cannot undercharge, overcharge, or duplicate billing items', async () => {
    const before = await owner.agent
      .post('/api/v1/billing/preview')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({});
    const beforeBranches = before.body.activeBranchCount;

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        owner.agent
          .post('/api/v1/branches')
          .set('X-Tenant-Id', tenant.tenantId)
          .send({ name: `Concurrent Branch ${i}-${Date.now()}`, timezone: 'UTC', currency: 'USD' }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);

    const after = await owner.agent
      .post('/api/v1/billing/preview')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({});
    expect(after.body.activeBranchCount).toBe(beforeBranches + 5);
    // Exactly 5 branches' worth of charge added — no drift, no duplication,
    // no lost updates from the concurrent writes. Checking the delta (not
    // an absolute formula) keeps this valid regardless of the billable user
    // count carried over from the earlier test in this file.
    expect(after.body.totalUsdCents - before.body.totalUsdCents).toBe(5 * 500);
  });
});
