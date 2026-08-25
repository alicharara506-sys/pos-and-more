import { getByPath, getNumberByPath, getStringByPath } from '../field-mapping';
import { withRetry } from '../retry';
import type {
  CanonicalCommerceEvent,
  CanonicalOrder,
  CanonicalOrderStatus,
  CanonicalProduct,
  CommerceConnector,
  ConnectionResult,
  HealthResult,
  InventoryUpdate,
  Page,
  PushResult,
  RawWebhookRequest,
  VerifiedWebhook,
  WebhookRegistrationResult,
} from '../types';

export interface ProductFieldMapping {
  externalId: string;
  name: string;
  description?: string;
  images?: string; // path to an array of image URL strings
  variants: string; // path to an array of raw variant objects (or '' if the product IS the variant, single-variant stores)
  variantExternalId: string;
  variantSku: string;
  variantBarcode?: string;
  variantPrice: string;
  variantCurrency?: string;
  variantInventoryQuantity?: string;
}

export interface OrderFieldMapping {
  externalId: string;
  orderNumber: string;
  status: string;
  statusMap?: Record<string, CanonicalOrderStatus>;
  currency: string;
  subtotal: string;
  taxTotal: string;
  shippingTotal: string;
  total: string;
  customerEmail?: string;
  createdAt: string;
  lines: string;
  lineName: string;
  lineQuantity: string;
  lineUnitPrice: string;
  lineSku?: string;
}

export interface UniversalRestConnectorConfig {
  providerName: string;
  baseUrl: string;
  buildAuthHeaders: (credentials: Record<string, string>) => Record<string, string>;
  endpoints: {
    listProducts: string;
    listOrders: string;
    updateInventory: (externalVariantId: string) => string;
    testConnection: string;
  };
  parsePage: (
    body: unknown,
    headers: Headers,
    requestedCursor?: string,
  ) => { items: unknown[]; nextCursor?: string };
  applyCursor: (url: URL, cursor: string) => void;
  productFieldMapping: ProductFieldMapping;
  orderFieldMapping: OrderFieldMapping;
  registerWebhooks: (
    credentials: Record<string, string>,
    callbackUrl: string,
  ) => Promise<WebhookRegistrationResult>;
  verifyWebhook: (
    credentials: Record<string, string>,
    request: RawWebhookRequest,
  ) => Promise<VerifiedWebhook>;
  normalizeWebhookPayload: (payload: unknown) => Promise<CanonicalCommerceEvent[]>;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * A configurable REST connector for custom/unlisted stores (spec §13.1
 * "Universal API connector"). Everything provider-specific — auth header
 * shape, pagination style, and how canonical fields map onto the store's
 * JSON — is data (a config object), not code, so a merchant (or an admin
 * on their behalf) can connect a new store without a SalesMaster Pro code
 * change. Webhook signature verification is the one piece that genuinely
 * can't be generalized across providers, so it stays a required callback.
 */
export class UniversalRestConnector implements CommerceConnector {
  readonly providerName: string;

  constructor(private readonly config: UniversalRestConnectorConfig) {
    this.providerName = config.providerName;
  }

  private get fetchImpl(): typeof fetch {
    return this.config.fetchImpl ?? fetch;
  }

  private authHeaders(credentials: Record<string, string>): Record<string, string> {
    return { ...this.config.buildAuthHeaders(credentials), Accept: 'application/json' };
  }

  async authorize(input: Record<string, string | undefined>): Promise<ConnectionResult> {
    const credentials = Object.fromEntries(
      Object.entries(input).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const health = await this.testConnection(credentials);
    if (!health.healthy) {
      throw new Error(
        `Could not authorize ${this.providerName}: ${health.message ?? 'unknown error'}`,
      );
    }
    return { externalAccountId: this.config.baseUrl, credentials };
  }

  async testConnection(credentials: Record<string, string>): Promise<HealthResult> {
    try {
      const res = await this.fetchImpl(
        `${this.config.baseUrl}${this.config.endpoints.testConnection}`,
        {
          headers: this.authHeaders(credentials),
        },
      );
      if (!res.ok) {
        return { healthy: false, message: `HTTP ${res.status}` };
      }
      return { healthy: true };
    } catch (err) {
      return { healthy: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  private async fetchPage(
    endpoint: string,
    credentials: Record<string, string>,
    cursor?: string,
  ): Promise<{ items: unknown[]; nextCursor?: string }> {
    const url = new URL(`${this.config.baseUrl}${endpoint}`);
    if (cursor) this.config.applyCursor(url, cursor);

    return withRetry(async () => {
      const res = await this.fetchImpl(url.toString(), { headers: this.authHeaders(credentials) });
      if (!res.ok) throw new Error(`${this.providerName} request failed: HTTP ${res.status}`);
      const body = await res.json();
      return this.config.parsePage(body, res.headers, cursor);
    });
  }

  private mapProduct(raw: unknown): CanonicalProduct {
    const m = this.config.productFieldMapping;
    const rawVariants = m.variants ? ((getByPath(raw, m.variants) as unknown[]) ?? []) : [raw];

    return {
      externalId: getStringByPath(raw, m.externalId),
      name: getStringByPath(raw, m.name),
      description: m.description ? getStringByPath(raw, m.description) : undefined,
      images: m.images ? ((getByPath(raw, m.images) as string[]) ?? []) : [],
      variants: rawVariants.map((rv) => ({
        externalId: getStringByPath(rv, m.variantExternalId),
        sku: getStringByPath(rv, m.variantSku),
        barcode: m.variantBarcode ? getStringByPath(rv, m.variantBarcode) || undefined : undefined,
        price: {
          amount: getStringByPath(rv, m.variantPrice, '0'),
          currencyCode: m.variantCurrency ? getStringByPath(rv, m.variantCurrency, 'USD') : 'USD',
        },
        inventoryQuantity: m.variantInventoryQuantity
          ? getNumberByPath(rv, m.variantInventoryQuantity)
          : undefined,
        attributes: {},
      })),
    };
  }

  private mapOrder(raw: unknown): CanonicalOrder {
    const m = this.config.orderFieldMapping;
    const rawStatus = getStringByPath(raw, m.status);
    const status = m.statusMap?.[rawStatus] ?? 'OPEN';
    const currency = getStringByPath(raw, m.currency, 'USD');
    const rawLines = (getByPath(raw, m.lines) as unknown[]) ?? [];

    return {
      externalId: getStringByPath(raw, m.externalId),
      orderNumber: getStringByPath(raw, m.orderNumber),
      status,
      currencyCode: currency,
      subtotal: { amount: getStringByPath(raw, m.subtotal, '0'), currencyCode: currency },
      taxTotal: { amount: getStringByPath(raw, m.taxTotal, '0'), currencyCode: currency },
      shippingTotal: { amount: getStringByPath(raw, m.shippingTotal, '0'), currencyCode: currency },
      total: { amount: getStringByPath(raw, m.total, '0'), currencyCode: currency },
      lines: rawLines.map((rl) => ({
        sku: m.lineSku ? getStringByPath(rl, m.lineSku) || undefined : undefined,
        name: getStringByPath(rl, m.lineName),
        quantity: getNumberByPath(rl, m.lineQuantity, 1),
        unitPrice: { amount: getStringByPath(rl, m.lineUnitPrice, '0'), currencyCode: currency },
      })),
      customerEmail: m.customerEmail
        ? getStringByPath(raw, m.customerEmail) || undefined
        : undefined,
      createdAt: getStringByPath(raw, m.createdAt, new Date().toISOString()),
    };
  }

  async pullProducts(
    credentials: Record<string, string>,
    cursor?: string,
  ): Promise<Page<CanonicalProduct>> {
    const page = await this.fetchPage(this.config.endpoints.listProducts, credentials, cursor);
    return { items: page.items.map((raw) => this.mapProduct(raw)), nextCursor: page.nextCursor };
  }

  async pullOrders(
    credentials: Record<string, string>,
    cursor?: string,
  ): Promise<Page<CanonicalOrder>> {
    const page = await this.fetchPage(this.config.endpoints.listOrders, credentials, cursor);
    return { items: page.items.map((raw) => this.mapOrder(raw)), nextCursor: page.nextCursor };
  }

  async pushProduct(): Promise<{ externalId: string }> {
    // Pushing SalesMaster-owned product data back to the store is provider-
    // specific enough (which fields are writable, required payload shape)
    // that the universal connector deliberately does not guess at it —
    // a native connector (e.g. WooCommerceConnector) implements this for
    // real; the universal path is pull-first (inventory/orders in,
    // products optionally mapped by the merchant) per spec §13.2's
    // "merchant chooses the source of truth per data domain".
    throw new Error(
      `${this.providerName}: pushProduct is not supported by the universal REST connector`,
    );
  }

  async pushInventory(
    credentials: Record<string, string>,
    updates: InventoryUpdate[],
  ): Promise<PushResult> {
    const succeeded: string[] = [];
    const failed: PushResult['failed'] = [];

    for (const update of updates) {
      try {
        const res = await this.fetchImpl(
          `${this.config.baseUrl}${this.config.endpoints.updateInventory(update.externalVariantId)}`,
          {
            method: 'PUT',
            headers: { ...this.authHeaders(credentials), 'Content-Type': 'application/json' },
            body: JSON.stringify({ quantity: update.quantity }),
          },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        succeeded.push(update.externalVariantId);
      } catch (err) {
        failed.push({
          externalVariantId: update.externalVariantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { succeeded, failed };
  }

  async registerWebhooks(
    credentials: Record<string, string>,
    callbackUrl: string,
  ): Promise<WebhookRegistrationResult> {
    return this.config.registerWebhooks(credentials, callbackUrl);
  }

  async verifyWebhook(
    credentials: Record<string, string>,
    request: RawWebhookRequest,
  ): Promise<VerifiedWebhook> {
    return this.config.verifyWebhook(credentials, request);
  }

  async normalize(payload: unknown): Promise<CanonicalCommerceEvent[]> {
    return this.config.normalizeWebhookPayload(payload);
  }
}
