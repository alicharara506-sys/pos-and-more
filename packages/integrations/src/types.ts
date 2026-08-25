/**
 * Canonical commerce models — the shapes every connector normalizes into,
 * and the only shapes apps/api's sync-job runner ever touches. Provider
 * payloads (Shopify's, WooCommerce's, a custom store's) never reach core
 * sales/inventory logic directly; each connector's `normalize()` maps its
 * own wire format to these. See docs/integrations.md.
 */

export interface CanonicalMoney {
  amount: string; // decimal string, never a float
  currencyCode: string; // ISO 4217
}

export interface CanonicalProductVariant {
  externalId: string;
  sku: string;
  barcode?: string;
  price: CanonicalMoney;
  inventoryQuantity?: number;
  attributes: Record<string, string>;
}

export interface CanonicalProduct {
  externalId: string;
  name: string;
  description?: string;
  images: string[];
  variants: CanonicalProductVariant[];
}

export interface CanonicalOrderLine {
  externalProductId?: string;
  externalVariantId?: string;
  sku?: string;
  name: string;
  quantity: number;
  unitPrice: CanonicalMoney;
}

export type CanonicalOrderStatus = 'OPEN' | 'PAID' | 'FULFILLED' | 'CANCELLED' | 'REFUNDED';

export interface CanonicalOrder {
  externalId: string;
  orderNumber: string;
  status: CanonicalOrderStatus;
  currencyCode: string;
  subtotal: CanonicalMoney;
  taxTotal: CanonicalMoney;
  shippingTotal: CanonicalMoney;
  total: CanonicalMoney;
  lines: CanonicalOrderLine[];
  customerEmail?: string;
  createdAt: string; // ISO 8601
}

export interface CanonicalCustomer {
  externalId: string;
  name: string;
  email?: string;
  phone?: string;
}

export type CanonicalCommerceEvent =
  | { type: 'product.updated'; product: CanonicalProduct }
  | { type: 'order.created'; order: CanonicalOrder }
  | { type: 'order.updated'; order: CanonicalOrder }
  | { type: 'order.cancelled'; externalOrderId: string }
  | { type: 'customer.updated'; customer: CanonicalCustomer };

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface AuthorizationInput {
  [key: string]: string | undefined;
}

export interface ConnectionResult {
  externalAccountId: string;
  /** Provider credentials to store — the caller (apps/api) is responsible for encrypting this before persisting. */
  credentials: Record<string, string>;
}

export interface HealthResult {
  healthy: boolean;
  message?: string;
}

export interface InventoryUpdate {
  externalVariantId: string;
  quantity: number;
}

export interface PushResult {
  succeeded: string[];
  failed: Array<{ externalVariantId: string; error: string }>;
}

export interface WebhookRegistrationResult {
  registeredTopics: string[];
}

export interface RawWebhookRequest {
  headers: Record<string, string>;
  rawBody: Buffer;
}

export interface VerifiedWebhook {
  eventId: string;
  eventType: string;
  payload: unknown;
}

/**
 * The connector contract every native/universal connector implements — see
 * docs/integrations.md. Keeping this interface stable is what lets a third
 * party add a new platform without touching core sales/inventory code
 * (spec §13.1 "Connector SDK").
 */
export interface CommerceConnector {
  readonly providerName: string;

  authorize(input: AuthorizationInput): Promise<ConnectionResult>;
  testConnection(credentials: Record<string, string>): Promise<HealthResult>;
  pullProducts(
    credentials: Record<string, string>,
    cursor?: string,
  ): Promise<Page<CanonicalProduct>>;
  pushProduct(
    credentials: Record<string, string>,
    product: CanonicalProduct,
  ): Promise<{ externalId: string }>;
  pullOrders(credentials: Record<string, string>, cursor?: string): Promise<Page<CanonicalOrder>>;
  pushInventory(
    credentials: Record<string, string>,
    updates: InventoryUpdate[],
  ): Promise<PushResult>;
  registerWebhooks(
    credentials: Record<string, string>,
    callbackUrl: string,
  ): Promise<WebhookRegistrationResult>;
  verifyWebhook(
    credentials: Record<string, string>,
    request: RawWebhookRequest,
  ): Promise<VerifiedWebhook>;
  normalize(payload: unknown): Promise<CanonicalCommerceEvent[]>;
}
