import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  await app.init();
  return app;
}

export interface TestActor {
  agent: ReturnType<typeof request.agent>;
  email: string;
  userId: string;
}

/** Registers + logs in a brand-new user, returning a cookie-jar-bound supertest agent. */
export async function createLoggedInUser(app: INestApplication): Promise<TestActor> {
  const email = `test-${randomUUID()}@example.com`;
  const password = 'correct-horse-battery-staple';
  const agent = request.agent(app.getHttpServer());

  const registerRes = await agent
    .post('/api/v1/auth/register')
    .send({ email, password, name: 'Test User' });
  if (registerRes.status !== 201) {
    throw new Error(`register failed: ${registerRes.status} ${JSON.stringify(registerRes.body)}`);
  }

  const loginRes = await agent.post('/api/v1/auth/login').send({ email, password });
  if (loginRes.status !== 201 && loginRes.status !== 200) {
    throw new Error(`login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }

  return { agent, email, userId: registerRes.body.id };
}

export interface TestTenant {
  tenantId: string;
  branchId: string;
}

/** Creates a fresh tenant (with owner membership + trial subscription) for the given logged-in actor. */
export async function createTestTenant(
  actor: TestActor,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<TestTenant> {
  const res = await actor.agent.post('/api/v1/onboarding/tenant').send({
    legalName: 'Test Co',
    displayName: 'Test Co',
    country: 'US',
    locale: 'en-US',
    timezone: 'UTC',
    baseCurrency: 'USD',
    firstBranchName: 'Main',
    ...overrides,
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`tenant creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { tenantId: res.body.tenant.id, branchId: res.body.branch.id };
}
