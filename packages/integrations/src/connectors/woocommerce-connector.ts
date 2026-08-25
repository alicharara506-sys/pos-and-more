import { createHmac, timingSafeEqual } from 'node:crypto';
import { UniversalRestConnector } from './universal-rest-connector';
import type {
  CanonicalCommerceEvent,
  RawWebhookRequest,
  VerifiedWebhook,
  WebhookRegistrationResult,
} from '../types';

export interface WooCommerceCredentials {
  consumerKey: string;
  consumerSecret: string;
  webhookSecret?: string;
}

const WOO_STATUS_MAP = {
  pending: 'OPEN',
  processing: 'PAID',
  'on-hold': 'OPEN',
  completed: 'FULFILLED',
  cancelled: 'CANCELLED',
  refunded: 'REFUNDED',
  failed: 'CANCELLED',
} as const;

/**
 * First-class WooCommerce connector (spec §13.1's Shopify/WooCommerce
 * native connectors). Built as a fully-specified configuration of
 * UniversalRestConnector rather than a hand-rolled HTTP client — this is
 * exactly the reuse the Connector SDK exists for: WooCommerce's REST API
 * (https://woocommerce.github.io/woocommerce-rest-api-docs/) is a
 * conventional paginated REST API, so nothing about it needs bespoke
 * request plumbing, only its specific auth/pagination/field shapes and
 * (unavoidably provider-specific) webhook signature scheme.
 */
export function createWooCommerceConnector(
  storeBaseUrl: string,
  fetchImpl?: typeof fetch,
): UniversalRestConnector {
  return new UniversalRestConnector({
    providerName: 'woocommerce',
    baseUrl: `${storeBaseUrl.replace(/\/$/, '')}/wp-json/wc/v3`,
    fetchImpl,
    buildAuthHeaders: (credentials) => {
      const basic = Buffer.from(
        `${credentials.consumerKey}:${credentials.consumerSecret}`,
      ).toString('base64');
      return { Authorization: `Basic ${basic}` };
    },
    endpoints: {
      testConnection: '/products?per_page=1',
      listProducts: '/products?per_page=50',
      listOrders: '/orders?per_page=50',
      updateInventory: (externalVariantId) => `/products/${externalVariantId}`,
    },
    applyCursor: (url, cursor) => {
      url.searchParams.set('page', cursor);
    },
    parsePage: (body, headers, requestedCursor) => {
      const currentPage = requestedCursor ? Number(requestedCursor) : 1;
      const totalPages = Number(headers.get('x-wp-totalpages') ?? '1');
      const items = Array.isArray(body) ? body : [];
      return { items, nextCursor: currentPage < totalPages ? String(currentPage + 1) : undefined };
    },
    productFieldMapping: {
      externalId: 'id',
      name: 'name',
      description: 'description',
      images: 'images', // WooCommerce image objects — see note below; consumers read `.src` themselves if needed
      variants: '', // WooCommerce "simple products" ARE the variant; '' tells the mapper to treat the product itself as its one variant
      variantExternalId: 'id',
      variantSku: 'sku',
      variantPrice: 'price',
      variantInventoryQuantity: 'stock_quantity',
    },
    orderFieldMapping: {
      externalId: 'id',
      orderNumber: 'number',
      status: 'status',
      statusMap: WOO_STATUS_MAP,
      currency: 'currency',
      subtotal: 'total', // WooCommerce doesn't expose a separate pre-tax subtotal at the order root; total is the closest stable field
      taxTotal: 'total_tax',
      shippingTotal: 'shipping_total',
      total: 'total',
      customerEmail: 'billing.email',
      createdAt: 'date_created',
      lines: 'line_items',
      lineName: 'name',
      lineQuantity: 'quantity',
      lineUnitPrice: 'price',
      lineSku: 'sku',
    },
    registerWebhooks: async (credentials, callbackUrl) => {
      const basic = Buffer.from(
        `${credentials.consumerKey}:${credentials.consumerSecret}`,
      ).toString('base64');
      const topics = ['product.updated', 'order.created', 'order.updated'];
      for (const topic of topics) {
        const res = await fetch(`${storeBaseUrl.replace(/\/$/, '')}/wp-json/wc/v3/webhooks`, {
          method: 'POST',
          headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `salesmaster-${topic}`, topic, delivery_url: callbackUrl }),
        });
        if (!res.ok)
          throw new Error(`Failed to register WooCommerce webhook ${topic}: HTTP ${res.status}`);
      }
      return { registeredTopics: topics };
    },
    verifyWebhook: async (credentials, request: RawWebhookRequest): Promise<VerifiedWebhook> => {
      const secret = credentials.webhookSecret;
      const signatureHeader = request.headers['x-wc-webhook-signature'];
      if (!secret || !signatureHeader) {
        throw new Error('Missing WooCommerce webhook secret or signature header');
      }
      const expected = createHmac('sha256', secret).update(request.rawBody).digest('base64');
      const expectedBuf = Buffer.from(expected);
      const actualBuf = Buffer.from(signatureHeader);
      if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
        throw new Error('WooCommerce webhook signature verification failed');
      }
      const payload = JSON.parse(request.rawBody.toString('utf8'));
      return {
        eventId: request.headers['x-wc-webhook-delivery-id'] ?? `${Date.now()}`,
        eventType: request.headers['x-wc-webhook-topic'] ?? 'unknown',
        payload,
      };
    },
    normalizeWebhookPayload: async (payload): Promise<CanonicalCommerceEvent[]> => {
      const raw = payload as Record<string, unknown>;
      // A webhook body for an order topic looks like a single WooCommerce order object.
      if (typeof raw.id === 'number' && typeof raw.status === 'string' && 'line_items' in raw) {
        return [{ type: 'order.created', order: mapWooOrderForEvent(raw) }];
      }
      if (typeof raw.id === 'number' && 'sku' in raw) {
        return [{ type: 'product.updated', product: mapWooProductForEvent(raw) }];
      }
      return [];
    },
  });
}

// Small standalone mappers for the webhook path, mirroring the field
// mapping config above — kept in sync deliberately rather than sharing
// UniversalRestConnector's private mapper, since a webhook body's shape is
// the single-resource form, not a list-page item, and this keeps the
// public normalize() contract independent of the connector instance.
function mapWooOrderForEvent(raw: Record<string, unknown>): import('../types').CanonicalOrder {
  const currency = String(raw.currency ?? 'USD');
  const lines = Array.isArray(raw.line_items) ? (raw.line_items as Record<string, unknown>[]) : [];
  const status = (WOO_STATUS_MAP as Record<string, string>)[String(raw.status)] ?? 'OPEN';
  return {
    externalId: String(raw.id),
    orderNumber: String(raw.number ?? raw.id),
    status: status as import('../types').CanonicalOrderStatus,
    currencyCode: currency,
    subtotal: { amount: String(raw.total ?? '0'), currencyCode: currency },
    taxTotal: { amount: String(raw.total_tax ?? '0'), currencyCode: currency },
    shippingTotal: { amount: String(raw.shipping_total ?? '0'), currencyCode: currency },
    total: { amount: String(raw.total ?? '0'), currencyCode: currency },
    lines: lines.map((l) => ({
      sku: l.sku ? String(l.sku) : undefined,
      name: String(l.name ?? ''),
      quantity: Number(l.quantity ?? 1),
      unitPrice: { amount: String(l.price ?? '0'), currencyCode: currency },
    })),
    customerEmail: (raw.billing as Record<string, unknown> | undefined)?.email as
      string | undefined,
    createdAt: String(raw.date_created ?? new Date().toISOString()),
  };
}

function mapWooProductForEvent(raw: Record<string, unknown>): import('../types').CanonicalProduct {
  return {
    externalId: String(raw.id),
    name: String(raw.name ?? ''),
    description: raw.description ? String(raw.description) : undefined,
    images: Array.isArray(raw.images)
      ? (raw.images as Array<{ src?: string }>).map((i) => i.src ?? '').filter(Boolean)
      : [],
    variants: [
      {
        externalId: String(raw.id),
        sku: String(raw.sku ?? ''),
        price: { amount: String(raw.price ?? '0'), currencyCode: 'USD' },
        inventoryQuantity:
          raw.stock_quantity !== undefined ? Number(raw.stock_quantity) : undefined,
        attributes: {},
      },
    ],
  };
}
