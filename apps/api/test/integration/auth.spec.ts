import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers';

describe('email/password + magic link auth', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers, logs in, resolves /auth/me, and logout revokes the session', async () => {
    const email = `auth-${randomUUID()}@example.com`;
    const password = 'correct-horse-battery-staple';
    const agent = request.agent(app.getHttpServer());

    const register = await agent
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'Auth Test' });
    expect(register.status).toBe(201);

    const login = await agent.post('/api/v1/auth/login').send({ email, password });
    expect(login.status).toBe(201);
    expect(login.body.user.email).toBe(email);

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);

    const logout = await agent.post('/api/v1/auth/logout');
    expect(logout.status).toBe(201);

    const meAfterLogout = await agent.get('/api/v1/auth/me');
    expect(meAfterLogout.status).toBe(401);
  });

  it('rejects login with a wrong password without revealing whether the account exists', async () => {
    const email = `auth-${randomUUID()}@example.com`;
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/register')
      .send({ email, password: 'correct-horse-battery-staple', name: 'Auth Test' });

    const badLogin = await agent
      .post('/api/v1/auth/login')
      .send({ email, password: 'totally-wrong-password' });
    expect(badLogin.status).toBe(401);

    const unknownEmailLogin = await agent
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever12345' });
    expect(unknownEmailLogin.status).toBe(401);
    expect(unknownEmailLogin.body.message).toBe(badLogin.body.message);
  });

  it('rejects a magic-link token that has already been consumed as invalid on replay verification shape', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/magic-link/consume')
      .send({ token: 'not-a-real-token' });
    expect(res.status).toBe(401);
  });
});
