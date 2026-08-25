import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createWooCommerceConnector } from '../connectors/woocommerce-connector';
import { createFakeFetch } from './test-fetch';
import productsFixture from '../fixtures/woocommerce-products.json';
import ordersFixture from '../fixtures/woocommerce-orders.json';

const CREDENTIALS = {
  consumerKey: 'ck_test',
  consumerSecret: 'cs_test',
  webhookSecret: 'whsec_test',
};

describe('WooCommerce connector (fixture-based contract tests)', () => {
  it('pulls and normalizes a page of products into canonical shape', async () => {
    const fetchImpl = createFakeFetch([
      {
        match: (u) => u.includes('/products'),
        headers: { 'x-wp-totalpages': '1' },
        body: productsFixture,
      },
    ]);
    const connector = createWooCommerceConnector('https://example-store.test', fetchImpl);

    const page = await connector.pullProducts(CREDENTIALS);

    expect(page.nextCursor).toBeUndefined();
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({
      externalId: '794',
      name: 'Premium Cotton T-Shirt',
      variants: [
        expect.objectContaining({
          externalId: '794',
          sku: 'TS-COTTON-BLK',
          price: { amount: '24.99', currencyCode: 'USD' },
          inventoryQuantity: 42,
        }),
      ],
    });
    expect(page.items[1]!.variants[0]!.inventoryQuantity).toBe(0);
  });

  it('follows X-WP-TotalPages-based pagination across multiple pages', async () => {
    let requestedPages: string[] = [];
    const fetchImpl = createFakeFetch([
      {
        match: (u) => {
          requestedPages.push(u);
          return u.includes('/products');
        },
        headers: { 'x-wp-totalpages': '2' },
        body: productsFixture,
      },
    ]);
    const connector = createWooCommerceConnector('https://example-store.test', fetchImpl);

    const firstPage = await connector.pullProducts(CREDENTIALS);
    expect(firstPage.nextCursor).toBe('2');

    const secondPage = await connector.pullProducts(CREDENTIALS, firstPage.nextCursor);
    expect(secondPage.nextCursor).toBeUndefined(); // page 2 of 2 -> no more pages

    expect(requestedPages.some((u) => u.includes('page=2'))).toBe(true);
  });

  it('pulls and normalizes orders, mapping WooCommerce status to canonical status', async () => {
    const fetchImpl = createFakeFetch([
      {
        match: (u) => u.includes('/orders'),
        headers: { 'x-wp-totalpages': '1' },
        body: ordersFixture,
      },
    ]);
    const connector = createWooCommerceConnector('https://example-store.test', fetchImpl);

    const page = await connector.pullOrders(CREDENTIALS);

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      externalId: '1042',
      orderNumber: '1042',
      status: 'PAID', // WooCommerce "processing" -> canonical PAID
      total: { amount: '37.49', currencyCode: 'USD' },
      customerEmail: 'customer@example.test',
      lines: [
        { sku: 'TS-COTTON-BLK', quantity: 1, unitPrice: { amount: '24.99', currencyCode: 'USD' } },
        {
          sku: 'MUG-CERAMIC-WHT',
          quantity: 1,
          unitPrice: { amount: '12.50', currencyCode: 'USD' },
        },
      ],
    });
  });

  it('reports unhealthy on a non-2xx test-connection response instead of throwing', async () => {
    const fetchImpl = createFakeFetch([
      { match: (u) => u.includes('/products'), status: 401, body: { message: 'Unauthorized' } },
    ]);
    const connector = createWooCommerceConnector('https://example-store.test', fetchImpl);

    const health = await connector.testConnection(CREDENTIALS);

    expect(health.healthy).toBe(false);
  });

  it('verifies a correctly-signed webhook and rejects a tampered one', async () => {
    const connector = createWooCommerceConnector('https://example-store.test');
    const body = Buffer.from(JSON.stringify(ordersFixture[0]));
    const validSignature = createHmac('sha256', CREDENTIALS.webhookSecret)
      .update(body)
      .digest('base64');

    const verified = await connector.verifyWebhook(CREDENTIALS, {
      headers: {
        'x-wc-webhook-signature': validSignature,
        'x-wc-webhook-topic': 'order.updated',
        'x-wc-webhook-delivery-id': 'delivery-1',
      },
      rawBody: body,
    });
    expect(verified.eventType).toBe('order.updated');

    await expect(
      connector.verifyWebhook(CREDENTIALS, {
        headers: { 'x-wc-webhook-signature': 'not-a-real-signature' },
        rawBody: body,
      }),
    ).rejects.toThrow(/signature/i);
  });

  it('normalizes a raw order webhook payload into a canonical commerce event', async () => {
    const connector = createWooCommerceConnector('https://example-store.test');
    const events = await connector.normalize(ordersFixture[0]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'order.created',
      order: { externalId: '1042', status: 'PAID' },
    });
  });
});
