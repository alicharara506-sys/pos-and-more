import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import {
  createLoggedInUser,
  createTestApp,
  createTestTenant,
  type TestActor,
  type TestTenant,
} from './helpers';

describe('AI assistant: honest not-configured behavior', () => {
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

  it('reports itself unconfigured (AI_PROVIDER=none in this environment)', async () => {
    const res = await owner.agent
      .get('/api/v1/assistant/status')
      .set('X-Tenant-Id', tenant.tenantId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false });
  });

  it('rejects a question with 503, never a fabricated answer', async () => {
    const res = await owner.agent
      .post('/api/v1/assistant/ask')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({ question: 'What were my sales last week?' });

    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/not configured/);
  });

  it('requires a tenant session, same as every other business-data route', async () => {
    const res = await owner.agent.get('/api/v1/assistant/status');
    expect(res.status).toBe(403); // TenantGuard rejects a missing X-Tenant-Id header
  });
});
