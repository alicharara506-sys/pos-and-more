import { createHmac } from 'node:crypto';
import http, { type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import {
  createLoggedInUser,
  createTestApp,
  createTestTenant,
  type TestActor,
  type TestTenant,
} from './helpers';

const WEBHOOK_SECRET = 'test-webhook-secret';

const FIXTURE_PRODUCTS = [
  {
    id: 501,
    name: 'Fixture Widget',
    sku: `WIDGET-${Date.now()}`,
    price: '9.99',
    stock_quantity: 3,
    description: '',
    images: [],
  },
];

/** A tiny in-process fake WooCommerce-shaped REST API — no external network involved. */
function startFixtureStore(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-WP-TotalPages', '1');
      if (req.url?.startsWith('/wp-json/wc/v3/products') && req.method === 'GET') {
        res.end(JSON.stringify(FIXTURE_PRODUCTS));
        return;
      }
      if (req.url?.startsWith('/wp-json/wc/v3/orders')) {
        res.end(JSON.stringify([]));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

describe('commerce integration hub: WooCommerce connector against a fixture store', () => {
  let app: INestApplication;
  let owner: TestActor;
  let tenant: TestTenant;
  let fixtureServer: Server;
  let storeBaseUrl: string;
  let connectionId: string;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await createLoggedInUser(app);
    tenant = await createTestTenant(owner);
    const fixture = await startFixtureStore();
    fixtureServer = fixture.server;
    storeBaseUrl = fixture.baseUrl;
  });

  afterAll(async () => {
    await new Promise((resolve) => fixtureServer.close(resolve));
    await app.close();
  });

  it('creates a connection by genuinely authorizing against the store', async () => {
    const res = await owner.agent
      .post('/api/v1/integrations/connections')
      .set('X-Tenant-Id', tenant.tenantId)
      .send({
        provider: 'WOOCOMMERCE',
        name: 'Fixture Store',
        storeUrl: storeBaseUrl,
        credentials: {
          consumerKey: 'ck_test',
          consumerSecret: 'cs_test',
          webhookSecret: WEBHOOK_SECRET,
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CONNECTED');
    expect(res.body).not.toHaveProperty('credentialsEncrypted');
    connectionId = res.body.id;
  });

  it('#8-equivalent: syncing products twice never duplicates the canonical product', async () => {
    const first = await owner.agent
      .post(`/api/v1/integrations/connections/${connectionId}/sync`)
      .set('X-Tenant-Id', tenant.tenantId)
      .send({ domain: 'PRODUCTS' });
    expect(first.status).toBe(201);
    expect(first.body.itemsProcessed).toBe(1);

    const second = await owner.agent
      .post(`/api/v1/integrations/connections/${connectionId}/sync`)
      .set('X-Tenant-Id', tenant.tenantId)
      .send({ domain: 'PRODUCTS' });
    expect(second.status).toBe(201);

    const products = await owner.agent.get('/api/v1/products').set('X-Tenant-Id', tenant.tenantId);
    const matching = products.body.products.filter(
      (p: { name: string }) => p.name === 'Fixture Widget',
    );
    expect(matching).toHaveLength(1);
  });

  it('#8: a replayed webhook delivery is deduplicated, never double-applied', async () => {
    // supertest/superagent JSON.stringify()s a Buffer body (Content-Type:
    // application/json triggers its serializer regardless of payload type),
    // corrupting the bytes the signature is computed over — so the wire
    // payload here is a plain string, which superagent writes verbatim, and
    // the signature is computed over that exact same UTF-8 byte sequence.
    const body = JSON.stringify({ ...FIXTURE_PRODUCTS[0], name: 'Fixture Widget (Renamed)' });
    const signature = createHmac('sha256', WEBHOOK_SECRET)
      .update(Buffer.from(body, 'utf8'))
      .digest('base64');

    const first = await owner.agent
      .post(`/api/v1/integrations/webhooks/${connectionId}`)
      .set('Content-Type', 'application/json')
      .set('x-wc-webhook-signature', signature)
      .set('x-wc-webhook-topic', 'product.updated')
      .set('x-wc-webhook-delivery-id', 'spec-delivery-1')
      .send(body);
    expect(first.status).toBe(201);
    expect(first.body.deduplicated).toBe(false);

    const replay = await owner.agent
      .post(`/api/v1/integrations/webhooks/${connectionId}`)
      .set('Content-Type', 'application/json')
      .set('x-wc-webhook-signature', signature)
      .set('x-wc-webhook-topic', 'product.updated')
      .set('x-wc-webhook-delivery-id', 'spec-delivery-1')
      .send(body);
    expect(replay.status).toBe(201);
    expect(replay.body.deduplicated).toBe(true);

    const products = await owner.agent.get('/api/v1/products').set('X-Tenant-Id', tenant.tenantId);
    const renamed = products.body.products.filter(
      (p: { name: string }) => p.name === 'Fixture Widget (Renamed)',
    );
    expect(renamed).toHaveLength(1); // updated in place, not duplicated
  });

  it('rejects a webhook with an invalid signature as 401, not 500', async () => {
    const body = JSON.stringify(FIXTURE_PRODUCTS[0]);
    const res = await owner.agent
      .post(`/api/v1/integrations/webhooks/${connectionId}`)
      .set('Content-Type', 'application/json')
      .set('x-wc-webhook-signature', 'not-a-valid-signature')
      .set('x-wc-webhook-topic', 'product.updated')
      .set('x-wc-webhook-delivery-id', 'spec-delivery-bad-sig')
      .send(body);

    expect(res.status).toBe(401);
  });
});
